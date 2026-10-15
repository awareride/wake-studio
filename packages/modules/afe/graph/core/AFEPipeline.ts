/**
 * AFE main-thread controller.
 *
 * Manages the AudioContext, microphone capture, the pipeline AudioWorkletNode,
 * and the message protocol between the main thread and the worklet. Implements
 * the AFEPipeline public API from docs/modules/afe.md §4.
 */

import type {
  AFEConfig,
  AFEOutputFrame,
  AFEStageKind,
  AFEStageParams,
  FileSourceConfig,
  MicSourceConfig,
  PipelineSource,
  RecordedClip,
  StageFrameData,
  StageParamsByKind,
  StageState,
} from './types'
import { validateStageParams } from './validate-params'
import { evaluateQualification, type QualificationResult } from './qualify'
import {
  AFEGeometryError,
  MAX_AFE_CHANNELS,
  validateGeometry,
} from './geometry'
import { DEFAULT_CONFIG, INTERNAL_SAMPLE_RATE } from './defaults'
import { describeParameters } from './defaults'
import type { MainMessage, WorkletMessage } from './types'
import { MicPermissionError, UnsupportedBrowserError } from './types'

// Vite bundles the worklet + its vendored RNNoise imports into a single file.
// The worklet lives in this module's web/ target; the `?worker&url` suffix is
// a Vite-specific import that resolves the worklet file as a URL string.
import workletUrl from '../web/pipeline-processor.worklet.ts?worker&url'

type FrameCallback = (data: StageFrameData) => void
type OutputCallback = (frame: AFEOutputFrame) => void

export class AFEPipeline {
  private _ctx: AudioContext | null = null
  private _node: AudioWorkletNode | null = null
  private _stream: MediaStream | null = null
  private _source: MediaStreamAudioSourceNode | null = null
  /** File-source nodes wired into the worklet (epic #53 P3). */
  private _fileNodes: AudioNode[] = []
  /** File-source dispose callback (stops the scheduler). */
  private _fileDispose: (() => void) | null = null
  /** Far-end (render) node wired into the worklet's reference input (#245). */
  private _referenceNode: AudioNode | null = null

  private _config: AFEConfig = { ...DEFAULT_CONFIG }
  private _bypass = { aec: true, bss: true, ns: false }
  /** Per-stage runtime params (issue #243), sent to the worklet on change. */
  private _stageParams: StageParamsByKind = {}
  /** Capture/array qualification verdict (issue #246); null until reported. */
  private _qualification: QualificationResult | null = null
  private _running = false
  private _latencyMs = 0

  private _frameCallbacks = new Set<FrameCallback>()
  private _outputCallbacks = new Set<OutputCallback>()

  // Recording promise resolver.
  private _recordResolver: ((clip: RecordedClip) => void) | null = null
  private _recordSeconds = 0

  // Persistent per-stage capture (epic #53 P5).
  private _chunkCallbacks = new Set<
    (stage: 'raw' | 'processed', samples: Float32Array, sampleRate: number) => void
  >()
  private _persistEndCallbacks = new Set<() => void>()

  // ---- public readonly state ----

  get running(): boolean {
    return this._running
  }

  get config(): AFEConfig {
    return this._config
  }

  get latencyMs(): number {
    return this._latencyMs
  }

  get stages(): ReadonlyArray<StageState> {
    return [
      { id: 'aec', kind: 'aec', status: 'bypassed', bypassed: this._bypass.aec },
      { id: 'bss', kind: 'bss', status: 'bypassed', bypassed: this._bypass.bss },
      {
        id: 'ns',
        kind: 'ns',
        status: this._bypass.ns ? 'bypassed' : 'ok',
        bypassed: this._bypass.ns,
      },
    ]
  }

  // ---- lifecycle ----

  async start(source?: PipelineSource): Promise<void> {
    if (this._running) return

    // Feature detection.
    if (
      typeof AudioContext === 'undefined' ||
      typeof AudioWorkletNode === 'undefined'
    ) {
      throw new UnsupportedBrowserError()
    }

    const fileSource = (source as FileSourceConfig | undefined)?.nodes
      ? (source as FileSourceConfig)
      : null
    // Mic config (used below for getUserMedia options + monitor routing).
    const micSource = source as MicSourceConfig | undefined
    // Far-end (render) reference, declared by either source kind (#245).
    const reference = fileSource?.reference ?? micSource?.reference

    // Declared geometry is validated before anything is started: a project
    // asking for channels the contract cannot express, or a reference nobody
    // declared (or a declared reference that never arrives), is a
    // misconfiguration and fails loudly rather than degrading quietly.
    validateGeometry(this._config)
    if (this._config.referenceChannels > 0 && !reference) {
      throw new AFEGeometryError(
        'AFE config declares ' +
          this._config.referenceChannels +
          ' far-end reference channel(s) but start() was given no reference node; ' +
          'an AEC stage is refused on a capture without a reference',
      )
    }
    if (reference && this._config.referenceChannels === 0) {
      throw new AFEGeometryError(
        'AFE reference node supplied but config.referenceChannels is 0; declare the ' +
          'reference before supplying one',
      )
    }

    if (fileSource) {
      // File source (epic #53 P3): the host already decoded + scheduled the
      // files; we just remember the nodes + dispose callback.
      this._fileNodes = fileSource.nodes
      this._fileDispose = fileSource.dispose
    } else {
      // Request microphone. Browser DSP toggles + device come from the source
      // config (epic #53 P2); defaults keep the current behavior (browser DSP
      // off so ours is the only processing, default device). The channel count
      // now comes from the declared geometry (issue #245), clamped to what the
      // contract can express.
      try {
        this._stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: micSource?.deviceId ? { exact: micSource.deviceId } : undefined,
            echoCancellation: micSource?.echoCancellation ?? false,
            noiseSuppression: micSource?.noiseSuppression ?? false,
            autoGainControl: micSource?.autoGainControl ?? false,
            channelCount: Math.max(1, Math.min(micSource?.channelCount ?? this._config.channels, MAX_AFE_CHANNELS)),
          },
        })
      } catch {
        throw new MicPermissionError()
      }
    }

    // Create AudioContext at 48 kHz (RNNoise-native, ADR-016).
    this._ctx = new AudioContext({ sampleRate: INTERNAL_SAMPLE_RATE })
    if (this._ctx.state === 'suspended') {
      await this._ctx.resume()
    }

    // Load the pipeline worklet (bundled by Vite via ?worker&url).
    await this._ctx.audioWorklet.addModule(workletUrl)

    // Wire the audio graph.
    // Inputs 0 = the mic/file planes, input 1 = the far-end reference
    // (issue #245). An unconnected reference input costs nothing and stays
    // silent. The channel counts are explicit so a stereo capture cannot
    // bleed into the reference plane (or the reverse) through channel-count
    // computation; the reference plane is always one channel.
    this._node = new AudioWorkletNode(this._ctx, 'pipeline-processor', {
      numberOfInputs: 2,
      channelCount: this._config.channels,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
    })
    if (reference) {
      this._referenceNode = reference
      reference.connect(this._node, 0, 1)
    }
    if (fileSource) {
      // File source: connect each scheduled node into the worklet.
      for (const node of this._fileNodes) {
        node.connect(this._node)
      }
    } else {
      this._source = this._ctx.createMediaStreamSource(this._stream!)
      this._source.connect(this._node)
    }
    // Connect to destination so the user can monitor the processed audio —
    // only when the mic config opts in (monitor, issue #140): speaker output
    // feeds back into the mic without headphones, so it is off by default.
    // File sources keep monitoring (no mic -> no feedback loop).
    const monitor = fileSource ? true : (micSource?.monitor ?? false)
    if (monitor) this._node.connect(this._ctx.destination)

    // Message handling.
    this._node.port.onmessage = (e: MessageEvent<WorkletMessage>) => {
      this._handleMessage(e.data)
    }

    // Send initial config.
    this._sendConfig()

    this._running = true
  }

  stop(): void {
    if (!this._running) return

    this._send({ type: 'stop' })

    this._node?.disconnect()
    this._source?.disconnect()
    // Release the far-end reference wiring (#245): disconnect this pipeline's
    // node from the caller's reference node, which may keep playing its own
    // audio.
    if (this._referenceNode && this._node) {
      try {
        this._referenceNode.disconnect(this._node)
      } catch {
        // Already disconnected.
      }
    }
    this._referenceNode = null
    this._stream?.getTracks().forEach((t) => t.stop())
    // Stop + release file sources (epic #53 P3).
    this._fileDispose?.()
    this._fileDispose = null
    for (const n of this._fileNodes) {
      try {
        n.disconnect()
      } catch {
        // Already stopped.
      }
    }
    this._fileNodes = []
    this._ctx?.close()

    this._node = null
    this._source = null
    this._stream = null
    this._ctx = null
    this._running = false
    // A new capture must be re-qualified (#246); the old verdict is stale.
    this._qualification = null
  }

  // ---- stage control ----

  setBypassed(stageId: string, bypassed: boolean): void {
    if (stageId in this._bypass) {
      ;(this._bypass as Record<string, boolean>)[stageId] = bypassed
      this._sendConfig()
    }
  }

  isBypassed(stageId: string): boolean {
    return (this._bypass as Record<string, boolean>)[stageId] ?? false
  }

  /**
   * Set runtime parameters for one stage (issue #243).
   *
   * Values are validated against the module spec's `params` before delivery:
   * unknown keys and out-of-range values are rejected with an error instead of
   * being silently dropped, so a dead control is visible rather than inert.
   * The stage ids here are the AFE stage kinds (`aec` / `bss` / `ns`).
   */
  setStageParams(kind: AFEStageKind, params: AFEStageParams): void {
    validateStageParams(kind, params)
    this._stageParams = { ...this._stageParams, [kind]: { ...params } }
    this._sendConfig()
  }

  /**
   * Capture / array qualification verdict (issue #246).
   *
   * `null` until the worklet has observed enough frames. Until a verdict is
   * `qualified`, spatial processing must stay disabled and the pipeline uses
   * mono passthrough — a stereo-looking stream is not evidence of two
   * independent microphones.
   */
  getCaptureQualification(): QualificationResult | null {
    return this._qualification
  }

  /** Whether a spatial AFE stage may be enabled right now. */
  isSpatialSupported(): boolean {
    return this._qualification?.spatialSupported === true
  }

  /**
   * Re-run the capture qualification probe (#246).
   *
   * The verdict describes the capture that produced it, so it is re-measured
   * rather than reused when the capture configuration changes (another device,
   * another channel count). Throws when the pipeline is not running: there is
   * no capture to qualify.
   */
  requalify(): void {
    if (!this._running || !this._node) {
      throw new Error('Pipeline is not running; there is no capture to qualify.')
    }
    // Drop the old verdict first so a UI reading it cannot present a stale
    // verdict as current while the new window accumulates.
    this._qualification = null
    this._send({ type: 'requalify' })
  }

  /** Current runtime parameters for one stage (empty when none were set). */
  getStageParams(kind: AFEStageKind): AFEStageParams {
    return { ...(this._stageParams[kind] ?? {}) }
  }

  // ---- subscriptions ----

  onFrame(cb: FrameCallback): () => void {
    this._frameCallbacks.add(cb)
    return () => this._frameCallbacks.delete(cb)
  }

  onOutput(cb: OutputCallback): () => void {
    this._outputCallbacks.add(cb)
    return () => this._outputCallbacks.delete(cb)
  }

  /**
   * Subscribe to persistent per-stage capture chunks (epic #53 P5). The
   * worklet streams `raw` (input) and `processed` (NS output) slices while
   * recordPersistent is active.
   */
  onRecordChunk(
    cb: (stage: 'raw' | 'processed', samples: Float32Array, sampleRate: number) => void,
  ): () => void {
    this._chunkCallbacks.add(cb)
    return () => this._chunkCallbacks.delete(cb)
  }

  /** Subscribe to the end of a persistent capture window. */
  onRecordEnd(cb: () => void): () => void {
    this._persistEndCallbacks.add(cb)
    return () => this._persistEndCallbacks.delete(cb)
  }

  // ---- A/B + record ----

  setABSource(source: 'raw' | 'processed'): void {
    this._send({ type: 'absource', source })
  }

  async record(seconds: number): Promise<RecordedClip> {
    if (!this._running || !this._node) {
      throw new Error('Pipeline is not running.')
    }
    this._recordSeconds = seconds
    this._send({ type: 'record', seconds })
    return new Promise<RecordedClip>((resolve) => {
      this._recordResolver = resolve
    })
  }

  /**
   * Start persistent per-stage capture (epic #53 P5): the worklet streams
   * raw/processed chunks until `seconds` elapses or stop() is called. Use
   * onRecordChunk / onRecordEnd to consume the stream.
   */
  recordPersistent(seconds: number): void {
    if (!this._running || !this._node) {
      throw new Error('Pipeline is not running.')
    }
    this._recordSeconds = seconds
    this._send({ type: 'record', seconds, persist: true })
  }

  // ---- config panel (ADR-017) ----

  setConfig(patch: Partial<AFEConfig>): void {
    const next = { ...this._config, ...patch }
    // Geometry is validated here too: moving a project from mono to an array,
    // or declaring a reference, must fail loudly on the main thread rather than
    // be clamped or ignored by the worklet.
    validateGeometry(next)
    this._config = next
    this._sendConfig()
  }

  describeParameters() {
    return describeParameters()
  }

  // ---- internals ----

  private _send(msg: MainMessage): void {
    this._node?.port.postMessage(msg)
  }

  private _sendConfig(): void {
    this._send({
      type: 'config',
      bypass: { ...this._bypass },
      vizFps: this._config.vizFps,
      // Declared capture geometry (issue #245). The worklet still measures
      // what actually arrives, and serves spatial processing only once the
      // capture is qualified (#246).
      channels: this._config.channels,
      referenceChannels: this._config.referenceChannels,
      spatialSupported: this._qualification?.spatialSupported === true,
      stageParams: Object.keys(this._stageParams).length
        ? (this._stageParams as StageParamsByKind)
        : undefined,
    })
  }

  private _handleMessage(msg: WorkletMessage): void {
    switch (msg.type) {
      case 'ready':
        this._sendConfig()
        break

      case 'capture-report': {
        // Judge what the OS actually delivered, not what was requested (#246).
        this._qualification = evaluateQualification({
          requestedChannels: this._config.channels,
          observedChannels: msg.observedChannels,
          sampleRate: msg.sampleRate,
          framesObserved: msg.framesObserved,
          maxPairCorrelation: msg.maxPairCorrelation,
          clipped: msg.clipped,
          energyRatio: msg.energyRatio,
        })
        // Push the verdict back into the worklet: until now it served mono
        // (fail safe), and a qualified capture is what opens the spatial path
        // (#245).
        this._sendConfig()
        break
      }

      case 'frame':
        for (const f of msg.frames) {
          // Measure latency: difference between when the frame was captured
          // (AudioContext time, converted to ms by the worklet) and now.
          if (this._ctx) {
            this._latencyMs = Math.max(
              0,
              this._ctx.currentTime * 1000 - f.capturedAtMs,
            )
          }
          this._frameCallbacks.forEach((cb) => cb(f))
        }
        break

      case 'output': {
        const frame: AFEOutputFrame = {
          samples: msg.samples,
          capturedAtMs: msg.capturedAtMs,
          vadActive: msg.vad > 0.5,
        }
        this._outputCallbacks.forEach((cb) => cb(frame))
        break
      }

      case 'error':
        console.error('[AFE worklet]', msg.message)
        break

      case 'recorded':
        if (this._recordResolver) {
          this._recordResolver({
            raw: msg.raw,
            processed: msg.processed,
            sampleRate: msg.sampleRate,
            durationMs: this._recordSeconds * 1000,
          })
          this._recordResolver = null
        }
        break

      case 'record-chunk':
        this._chunkCallbacks.forEach((cb) =>
          cb(msg.stage, msg.samples, msg.sampleRate),
        )
        break

      case 'record-end':
        this._persistEndCallbacks.forEach((cb) => cb())
        break
    }
  }
}
