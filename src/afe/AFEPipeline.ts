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
  RecordedClip,
  StageFrameData,
  StageState,
} from './types'
import { DEFAULT_CONFIG, INTERNAL_SAMPLE_RATE } from './defaults'
import { describeParameters } from './defaults'
import type { MainMessage, WorkletMessage } from './types'
import { MicPermissionError, UnsupportedBrowserError } from './types'

// Vite bundles the worklet + its vendored RNNoise imports into a single file.
import workletUrl from './pipeline-processor.worklet.ts?worker&url'

type FrameCallback = (data: StageFrameData) => void
type OutputCallback = (frame: AFEOutputFrame) => void

export class AFEPipeline {
  private _ctx: AudioContext | null = null
  private _node: AudioWorkletNode | null = null
  private _stream: MediaStream | null = null
  private _source: MediaStreamAudioSourceNode | null = null

  private _config: AFEConfig = { ...DEFAULT_CONFIG }
  private _bypass = { aec: true, bss: true, ns: false }
  private _running = false
  private _latencyMs = 0

  private _frameCallbacks = new Set<FrameCallback>()
  private _outputCallbacks = new Set<OutputCallback>()

  // Recording promise resolver.
  private _recordResolver: ((clip: RecordedClip) => void) | null = null
  private _recordSeconds = 0

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

  async start(): Promise<void> {
    if (this._running) return

    // Feature detection.
    if (
      typeof AudioContext === 'undefined' ||
      typeof AudioWorkletNode === 'undefined'
    ) {
      throw new UnsupportedBrowserError()
    }

    // Request microphone (browser DSP disabled so ours is the only processing).
    try {
      this._stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: this._config.channels,
        },
      })
    } catch {
      throw new MicPermissionError()
    }

    // Create AudioContext at 48 kHz (RNNoise-native, ADR-016).
    this._ctx = new AudioContext({ sampleRate: INTERNAL_SAMPLE_RATE })
    if (this._ctx.state === 'suspended') {
      await this._ctx.resume()
    }

    // Load the pipeline worklet (bundled by Vite via ?worker&url).
    await this._ctx.audioWorklet.addModule(workletUrl)

    // Wire the audio graph.
    this._source = this._ctx.createMediaStreamSource(this._stream)
    this._node = new AudioWorkletNode(this._ctx, 'pipeline-processor')
    this._source.connect(this._node)
    // Connect to destination so the user can monitor the processed audio.
    this._node.connect(this._ctx.destination)

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
    this._stream?.getTracks().forEach((t) => t.stop())
    this._ctx?.close()

    this._node = null
    this._source = null
    this._stream = null
    this._ctx = null
    this._running = false
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

  // ---- subscriptions ----

  onFrame(cb: FrameCallback): () => void {
    this._frameCallbacks.add(cb)
    return () => this._frameCallbacks.delete(cb)
  }

  onOutput(cb: OutputCallback): () => void {
    this._outputCallbacks.add(cb)
    return () => this._outputCallbacks.delete(cb)
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

  // ---- config panel (ADR-017) ----

  setConfig(patch: Partial<AFEConfig>): void {
    this._config = { ...this._config, ...patch }
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
    })
  }

  private _handleMessage(msg: WorkletMessage): void {
    switch (msg.type) {
      case 'ready':
        this._sendConfig()
        break

      case 'frame':
        for (const f of msg.frames) {
          // Measure latency: difference between when the frame was captured
          // (in AudioContext time) and the current AudioContext time.
          if (this._ctx) {
            this._latencyMs = Math.max(
              0,
              (this._ctx.currentTime - f.capturedAtMs) * 1000,
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
    }
  }
}
