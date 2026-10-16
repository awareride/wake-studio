/**
 * AFE pipeline AudioWorklet processor (single-worklet topology, ADR-016).
 *
 * Runs the stage chain AEC -> BSS -> NS at 48 kHz inside a single AudioWorklet
 * by **driving each stage module through the AFEStage interface** (ADR-025):
 *   - AEC: `@wake-studio/module-afe-aec` AecStage (passthrough for v1, ADR-016)
 *   - BSS: `@wake-studio/module-afe-bss` BssStage (passthrough for v1, ADR-016)
 *   - NS:  `@wake-studio/module-rnnoise` RnnoiseNsStage (RNNoise WASM, denoises
 *          480-sample frames in place)
 *
 * The stage engines are pure TS over their own wasm interfaces - no DOM, so
 * they import cleanly into the AudioWorkletGlobalScope. The graph module owns
 * only the *scheduling* (circular buffer, frame assembly, viz throttling,
 * recording) - not the stage DSP.
 *
 * **Geometry (issue #245).** A stage declares what it consumes and produces
 * (`AFEStage.geometry`), the project declares what its capture has
 * (`AFEConfig.channels` / `referenceChannels`), and this file serves the
 * difference exactly as the device graph does (docs/modules/sdk.md §4.2.2):
 * never fewer channels than declared, no reference to a stage that declared one
 * without a reference existing, and a graph-owned downmix for a mono-declared
 * stage on a multi-channel capture. The worklet measures what actually arrived
 * (`inputs[0].length`) and never trusts the declaration; a capture that has not
 * been qualified for spatial processing (#246) is served mono.
 *
 * Callback discipline: every buffer the audio path touches is preallocated in
 * the constructor (mic planes, reference planes, mono scratch, stage slots).
 * The only per-frame allocations are the few subarray views the frame loop
 * already used before geometry existed, and the plan objects recomputed when
 * the delivered geometry changes - at most a handful of times per run, never
 * per frame.
 *
 * Emits per-stage visualization data (throttled to vizFps) and 16 kHz output
 * frames (160 samples / 10 ms) for downstream KWS.
 */

// Stage modules (pure TS cores; see above). The NS stage's wasm glue is
// imported from the rnnoise module's worklet-safe loader sub-entry
// (synchronous, base64-embedded; no React/UI in the bundle).
import { AecStage } from '@wake-studio/module-afe-aec'
import { BssStage } from '@wake-studio/module-afe-bss'
import { loadRnnoiseStage } from '@wake-studio/module-rnnoise/web/loader'

import type { AFEStage } from '@wake-studio/contracts'
import { ChannelProbe, MIN_OBSERVATION_FRAMES } from '../core/qualify'
import {
  MAX_AFE_CHANNELS,
  downmixToMono,
  planStage,
  servedMicChannels,
  stageGeometry,
  type GeometryAction,
  type StageGeometryPlan,
} from '../core/geometry'
import type {
  AFEStageKind,
  MainMessage,
  StageFrameData,
  StageParamsByKind,
  WorkletMessage,
} from '../core/types'
import {
  CIRCULAR_BUFFER_SIZE,
  INTERNAL_SAMPLE_RATE,
  QUANTUM_SIZE,
  RNNOISE_FRAME_SIZE,
} from '../core/defaults'
import { SpectrogramHistory } from '../core/spectrogram-history'
import {
  downsample48to16,
  downsampleForViz,
  levelDb,
  spectrogramColumn,
  SPECTROGRAM_WINDOW_SIZE,
} from '@wake-studio/dsp'

const PROCESSOR_NAME = 'pipeline-processor'

/** One stage in the chain plus its resolved geometry slot (issue #245). */
interface StageSlot {
  kind: AFEStageKind
  stage: AFEStage | null
  /** How this stage is served for the current delivery. */
  plan: StageGeometryPlan
  /** Refusals are reported once, not on every frame. */
  reported: boolean
}

function refusePlan(reason: string): StageGeometryPlan {
  return { action: 'refuse' as GeometryAction, micChannels: 0, referenceChannels: 0, reason }
}

/**
 * Stage overrides, used by tests to drive the geometry paths with stages that
 * actually declare an array (no shipped stage does yet - AEC/BSS are
 * passthrough and RNNoise is mono, ADR-016).
 */
export interface ProcessorStageOverrides {
  aec?: AFEStage | null
  bss?: AFEStage | null
  ns?: AFEStage | null
}

class PipelineProcessor extends AudioWorkletProcessor {
  // Stage modules, driven through the AFEStage interface.
  private _aec: AFEStage | null
  private _bss: AFEStage | null
  /**
   * Capture/array qualification probe (issue #246).
   *
   * Fed from the REAL `inputs[0]` channel arrays on every frame, so the verdict
   * reflects what the OS actually delivered rather than what was requested.
   * Allocation-free: `ChannelProbe` keeps running sums only.
   */
  private _probe = new ChannelProbe()
  private _reportedCapture = false
  private _ns: AFEStage | null = null

  // --- geometry (issue #245) -------------------------------------------------
  /** Declared capture geometry, from the config message. */
  private _channels = 1
  private _referenceChannels = 0
  /** Whether the running capture is qualified for spatial processing (#246). */
  private _spatialSupported = false
  /** Mic/reference planes actually served (delivery + the #246 gate). */
  private _servedMicChannels = 1
  private _servedRefChannels = 0
  /** Delivered channel counts last observed in the callback. */
  private _deliveredMic = -1
  private _deliveredRef = -1

  /**
   * Per-channel planes, preallocated for the maximum a capture can declare
   * (mirrors the device graph's WAKE_AFE_MAX_CHANNELS). Channel 0 IS the chain
   * circular buffer (LCM(128, 480) = 1920 samples); the rest only exist for a
   * spatial stage.
   */
  private _planes: Float32Array[] = Array.from(
    { length: MAX_AFE_CHANNELS },
    () => new Float32Array(CIRCULAR_BUFFER_SIZE),
  )
  private _refPlanes: Float32Array[] = Array.from(
    { length: MAX_AFE_CHANNELS },
    () => new Float32Array(CIRCULAR_BUFFER_SIZE),
  )
  /** Scratch plane the graph owns when it downmixes for a mono-declared stage. */
  private _monoScratch = new Float32Array(RNNOISE_FRAME_SIZE)
  /**
   * Preallocated handoff arrays for the planar path. Only their `length` is
   * trimmed per frame (same backing store), so the audio callback never
   * allocates: this is what tests/callback-discipline.test.ts enforces.
   */
  private _handoff: Float32Array[] = new Array<Float32Array>(MAX_AFE_CHANNELS)
  private _refHandoff: Float32Array[] = new Array<Float32Array>(MAX_AFE_CHANNELS)

  /** Fixed slots, in pipeline order (ADR-001). */
  private _slots: StageSlot[] = [
    { kind: 'aec', stage: null, plan: refusePlan('not initialised'), reported: false },
    { kind: 'bss', stage: null, plan: refusePlan('not initialised'), reported: false },
    { kind: 'ns', stage: null, plan: refusePlan('not initialised'), reported: false },
  ]

  private _inputLength = 0
  private _denoisedLength = 0
  private _denoisedIndex = 0

  // Contiguous spectrogram history (newest SPECTROGRAM_WINDOW_SIZE samples).
  private _specHistory = new SpectrogramHistory(SPECTROGRAM_WINDOW_SIZE)
  // Same for the denoised (NS) stream so its column is a real window too.
  private _nsSpecHistory = new SpectrogramHistory(SPECTROGRAM_WINDOW_SIZE)

  // Viz throttling.
  private _lastVizTime = 0
  private _vizInterval = 1 / 30 // seconds; updated from config

  // Config (updated via messages).
  private _bypass = { aec: true, bss: true, ns: false }
  private _abSource: 'raw' | 'processed' = 'processed'

  // Recording state.
  private _recording = false
  private _recordRemaining = 0
  private _rawRecord: Float32Array | null = null
  private _processedRecord: Float32Array | null = null
  private _recordOffset = 0
  /** Persistent capture streams chunks (epic #53 P5). */
  private _persistMode = false
  /** Chunk accumulators for streaming (flushed every ~10 ms). */
  private _rawChunkAccum: Float32Array[] = []
  private _processedChunkAccum: Float32Array[] = []

  // Last denoised NS frame (always available for viz, even during buffer wrap-around).
  private _lastNsFrame = new Float32Array(RNNOISE_FRAME_SIZE)
  private _hasNsFrame = false

  constructor(options?: AudioWorkletNodeOptions) {
    super()
    // `options` is the browser's AudioWorkletNodeOptions; the stage overrides
    // are a test seam so the geometry paths can be driven with a stage that
    // actually declares an array (no shipped stage does yet - AEC/BSS are
    // passthrough and RNNoise is mono, ADR-016).
    const overrides = options as (AudioWorkletNodeOptions & ProcessorStageOverrides) | undefined

    // AEC + BSS: passthrough engines (v1).
    this._aec = overrides && 'aec' in overrides ? (overrides.aec ?? null) : new AecStage()
    this._bss = overrides && 'bss' in overrides ? (overrides.bss ?? null) : new BssStage()
    this._slots[0].stage = this._aec
    this._slots[1].stage = this._bss

    // NS: RNNoise, synchronously instantiated (addModule doesn't await promises).
    try {
      this._ns = overrides && 'ns' in overrides ? (overrides.ns ?? null) : loadRnnoiseStage()
      this._slots[2].stage = this._ns
    } catch (err) {
      this._ns = null
      this._post({ type: 'error', message: 'RNNoise init failed: ' + String(err) })
    }

    // Resolve the geometry slots for the default (mono, no reference) delivery.
    this._recomputePlans()

    this.port.onmessage = (e: MessageEvent<MainMessage>) => {
      this._handleMessage(e.data)
    }

    this._post({ type: 'ready' })
  }

  /**
   * Re-resolve how every stage is served. Called when the declared geometry or
   * the delivered geometry changes, never per frame.
   *
   * The gate that matters here is #246's: a project may *declare* an array, but
   * until the capture is qualified the graph serves mono, so a stereo-looking
   * stream can never reach a spatial stage. The declared-but-served difference
   * is reported once via `spatial-served`.
   */
  private _recomputePlans(): void {
    const served = servedMicChannels(
      { channels: this._channels, referenceChannels: this._referenceChannels },
      this._spatialSupported,
    )
    this._servedMicChannels = Math.max(1, Math.min(served.micChannels, MAX_AFE_CHANNELS))
    this._servedRefChannels =
      this._referenceChannels > 0
        ? Math.min(this._referenceChannels, Math.max(0, this._deliveredRef))
        : 0

    for (const slot of this._slots) {
      const declared = stageGeometry(slot.stage?.geometry)
      slot.plan = planStage(declared, {
        micChannels: this._servedMicChannels,
        referenceChannels: this._servedRefChannels,
      })
      // A planar stage with no planar entry point is not runnable: refusing is
      // the honest answer, the same one a missing reference gets.
      if (
        slot.plan.action !== 'refuse' &&
        (slot.plan.micChannels > 1 || slot.plan.referenceChannels > 0) &&
        typeof slot.stage?.processFrame !== 'function'
      ) {
        slot.plan = refusePlan(
          'stage declares ' +
            declared.inputChannels +
            ' mic / ' +
            declared.referenceChannels +
            ' reference channel(s) but implements no planar process() entry point',
        )
      }
      slot.reported = false
    }
  }

  /**
   * Post the capture/array qualification report once the observation window is
   * long enough (#246). Reported at most once per run; the main thread turns it
   * into a `qualified | degraded | unsupported` verdict.
   */
  private _maybeReportCapture(): void {
    if (this._reportedCapture) return
    if (this._probe.frames < MIN_OBSERVATION_FRAMES) return
    this._reportedCapture = true
    this._post({
      type: 'capture-report',
      observedChannels: this._probe.channels,
      sampleRate,
      framesObserved: this._probe.frames,
      maxPairCorrelation: this._probe.correlation,
      clipped: this._probe.clipped,
      energyRatio: this._probe.energyRatio,
    })
  }

  /**
   * Apply per-stage runtime parameters (issue #243).
   *
   * Deliberately permissive: the main thread already validated these against
   * each module's `module.spec.json` (`validateStageParams`), and a throw in an
   * audio callback would tear down the AudioWorklet. An unknown stage or a stage
   * without a `configure` seam is ignored rather than fatal.
   */
  private _applyStageParams(stageParams: StageParamsByKind | undefined): void {
    if (!stageParams) return
    const apply = (kind: AFEStageKind, stage: AFEStage | null): void => {
      const params = stageParams[kind]
      if (!params || !stage) return
      if (typeof stage.configure !== 'function') return
      try {
        stage.configure(params)
      } catch (err) {
        this._post({ type: 'error', message: `AFE ${kind} params rejected: ${String(err)}` })
      }
    }
    apply('aec', this._aec)
    apply('bss', this._bss)
    apply('ns', this._ns)
  }

  private _handleMessage(msg: MainMessage): void {
    switch (msg.type) {
      case 'config':
        this._bypass = msg.bypass
        this._vizInterval = 1 / msg.vizFps
        this._applyStageParams(msg.stageParams)
        // Geometry is delivered as state, and the worklet re-resolves its plans
        // here (outside the audio callback) rather than inferring anything
        // about the capture from the declaration.
        if (msg.channels !== undefined) this._channels = msg.channels
        if (msg.referenceChannels !== undefined) this._referenceChannels = msg.referenceChannels
        if (msg.spatialSupported !== undefined) this._spatialSupported = msg.spatialSupported
        this._recomputePlans()
        break
      case 'absource':
        this._abSource = msg.source
        break
      case 'requalify':
        // A new verdict must describe the NEW capture, not the old window.
        // Allocation here is fine: this is a message handler, not the audio
        // callback (the probe itself stays allocation-free per frame).
        this._probe = new ChannelProbe()
        this._reportedCapture = false
        break
      case 'record': {
        const persist = msg.persist === true
        const total = Math.floor(msg.seconds * sampleRate)
        this._persistMode = persist
        // Persist mode streams chunks and never materializes the one-shot
        // arrays — a long "until stop" capture (e.g. 3600 s) would otherwise
        // allocate ~1.4 GB for raw + processed (epic #53 P5).
        if (!persist) {
          this._rawRecord = new Float32Array(total)
          this._processedRecord = new Float32Array(total)
        }
        this._recordRemaining = total
        this._recordOffset = 0
        this._recording = true
        this._rawChunkAccum = []
        this._processedChunkAccum = []
        break
      }
      case 'stop':
        // The node is destroyed from the main thread; nothing to do here.
        break
    }
  }

  private _post(msg: WorkletMessage): void {
    this.port.postMessage(msg)
  }

  /** Concatenate the accumulated chunk slices and post them (epic #53 P5). */
  private _flushChunks(): void {
    if (this._rawChunkAccum.length > 0) {
      const raw = concatFloat32(this._rawChunkAccum)
      this._post({ type: 'record-chunk', stage: 'raw', samples: raw, sampleRate })
      this._rawChunkAccum = []
    }
    if (this._processedChunkAccum.length > 0) {
      const proc = concatFloat32(this._processedChunkAccum)
      this._post({ type: 'record-chunk', stage: 'processed', samples: proc, sampleRate })
      this._processedChunkAccum = []
    }
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const inData = inputs[0]?.[0]
    const outData = outputs[0]?.[0]
    if (!inData) return true

    // --- 0. Observe the channels that actually arrived (#246) -------------
    // Note we feed the real channel arrays and use their real length below;
    // nothing here assumes the usual 128-frame quantum.
    this._probe.observe(inputs[0])
    this._maybeReportCapture()

    // The delivered geometry is measured, never assumed. A change re-resolves
    // the stage plans (a one-off cost, outside the per-frame path).
    const deliveredMic = inputs[0].length
    const deliveredRef =
      this._referenceChannels > 0 ? (inputs[1]?.length ?? 0) : 0
    if (deliveredMic !== this._deliveredMic || deliveredRef !== this._deliveredRef) {
      this._deliveredMic = deliveredMic
      this._deliveredRef = deliveredRef
      this._recomputePlans()
    }

    // --- 1. Append the served planes to the circular buffer ---------------
    // Only the planes the graph actually serves are copied: until a capture is
    // qualified for spatial processing, that is channel 0 and nothing else.
    const writeAt = this._inputLength
    for (let c = 0; c < this._servedMicChannels; c++) {
      const plane = inputs[0][c]
      if (!plane) break
      this._planes[c].set(plane, writeAt)
    }
    this._inputLength += inData.length
    // Also append to the spectrogram history (contiguous window source).
    this._specHistory.push(inData)

    // Far-end reference, when the project declared one and the node has it.
    if (this._servedRefChannels > 0) {
      const refPlane = inputs[1]?.[0]
      if (refPlane) this._refPlanes[0].set(refPlane, writeAt)
    }

    // --- 2. Run the stage chain over 480-sample frames ---
    while (this._denoisedLength + RNNOISE_FRAME_SIZE <= this._inputLength) {
      const start = this._denoisedLength
      const end = start + RNNOISE_FRAME_SIZE
      // The chain stream: plane 0 unless a planar or mono-downmixing stage
      // took it over.
      let frame = this._planes[0].subarray(start, end)

      // AEC -> BSS -> NS through the AFEStage interface.
      // AEC/BSS: passthrough engines for v1 (their process() is a no-op on the
      // frame, but the interface call keeps the chain honest + future-proof).
      let vad = 0
      for (const slot of this._slots) {
        const plan = slot.plan
        const stage = slot.stage
        if (plan.action === 'refuse') {
          if (!slot.reported) {
            slot.reported = true
            this._post({ type: 'error', message: `AFE ${slot.kind} not run: ${plan.reason}` })
          }
          continue
        }
        if (this._bypass[slot.kind] || !stage) continue

        if (plan.micChannels > 1 || plan.referenceChannels > 0) {
          // Planar path: rebuild the per-channel views for this frame and the
          // reference plane, then hand exactly `micChannels` planes to the
          // stage. The handoff arrays are preallocated and only their length is
          // trimmed, so the audio callback allocates nothing here.
          const handoff = this._handoff
          for (let c = 0; c < plan.micChannels; c++) {
            handoff[c] = this._planes[c].subarray(start, end)
          }
          handoff.length = plan.micChannels
          let reference: Float32Array[] | null = null
          if (plan.referenceChannels > 0) {
            this._refHandoff[0] = this._refPlanes[0].subarray(start, end)
            this._refHandoff.length = plan.referenceChannels
            reference = this._refHandoff
          }
          const result = stage.processFrame!(handoff, reference)
          handoff.length = MAX_AFE_CHANNELS
          this._refHandoff.length = MAX_AFE_CHANNELS
          vad = Math.max(vad, result.vadProbability)
          frame = handoff[0]
        } else if (plan.action === 'downmix') {
          // A mono-declared stage on a multi-channel capture: the graph owns
          // the conversion, exactly as the device graph does.
          const handoff = this._handoff
          for (let c = 0; c < this._servedMicChannels; c++) {
            handoff[c] = this._planes[c].subarray(start, end)
          }
          handoff.length = this._servedMicChannels
          downmixToMono(handoff, this._monoScratch)
          handoff.length = MAX_AFE_CHANNELS
          const result = stage.process(this._monoScratch)
          vad = Math.max(vad, result.vadProbability)
          frame = this._monoScratch
        } else {
          const result = stage.process(frame)
          vad = Math.max(vad, result.vadProbability)
        }
      }

      // Keep a copy of the last NS frame for stable visualization
      // (avoids intermittent missing data during circular-buffer wrap-around).
      this._lastNsFrame.set(frame)
      this._hasNsFrame = true
      // Feed the denoised frame into the NS spectrogram history so its column
      // comes from a full contiguous window, not a single zero-padded frame.
      this._nsSpecHistory.push(frame)

      // Downsample to 16 kHz and post output for KWS.
      const out160 = downsample48to16(frame)
      this._post({
        type: 'output',
        samples: out160,
        // `currentTime` is AudioContext time in SECONDS; the field is named
        // ...Ms and consumers (e.g. the KWS trigger's minDurationMs /
        // cooldownMs comparisons) treat it as milliseconds. Convert here, at
        // the single source, so the name is honest downstream.
        capturedAtMs: currentTime * 1000,
        vad,
      })

      this._denoisedLength += RNNOISE_FRAME_SIZE
    }

    // --- 3. Copy denoised audio to the output quantum (for monitoring) ---
    let unsent: number
    if (this._denoisedIndex > this._denoisedLength) {
      unsent = CIRCULAR_BUFFER_SIZE - this._denoisedIndex
    } else {
      unsent = this._denoisedLength - this._denoisedIndex
    }

    if (unsent >= outData.length) {
      const chunk = this._planes[0].subarray(
        this._denoisedIndex,
        this._denoisedIndex + outData.length,
      )
      // During recording, always output processed so the user hears denoised audio.
      const source = this._recording ? 'processed' : this._abSource
      if (source === 'processed') {
        outData.set(chunk)
      } else {
        // Raw: the input we just received (for A/B comparison).
        outData.set(inData)
      }
      this._denoisedIndex += outData.length
    }

    // --- 3b. Recording: capture raw + processed ---
    if (this._recording && (this._persistMode || (this._rawRecord && this._processedRecord))) {
      const n = Math.min(inData.length, this._recordRemaining)
      if (this._persistMode) {
        // Stream chunks (epic #53 P5): push raw + processed slices every
        // ~4 quanta (~10 ms) to keep the main thread warm.
        this._rawChunkAccum.push(inData.subarray(0, n))
        this._processedChunkAccum.push(outData.subarray(0, n))
        if (this._recordOffset % (QUANTUM_SIZE * 4) === 0) {
          this._flushChunks()
        }
      } else {
        const raw = this._rawRecord!
        const processed = this._processedRecord!
        raw.set(inData.subarray(0, n), this._recordOffset)
        processed.set(outData.subarray(0, n), this._recordOffset)
      }
      this._recordOffset += n
      this._recordRemaining -= n

      if (this._recordRemaining <= 0) {
        this._recording = false
        if (this._persistMode) {
          this._flushChunks()
          this._post({ type: 'record-end' })
        } else {
          const raw = this._rawRecord!
          const processed = this._processedRecord!
          this._post({
            type: 'recorded',
            raw,
            processed,
            sampleRate,
          })
        }
        this._rawRecord = null
        this._processedRecord = null
        this._rawChunkAccum = []
        this._processedChunkAccum = []
      }
    }

    // --- 4. Handle circular buffer wrap-around ---
    if (this._denoisedIndex >= CIRCULAR_BUFFER_SIZE) {
      this._denoisedIndex = 0
    }
    if (this._inputLength >= CIRCULAR_BUFFER_SIZE) {
      this._inputLength = 0
      this._denoisedLength = 0
    }

    // --- 5. Post visualization data (throttled to vizFps) ---
    if (currentTime - this._lastVizTime >= this._vizInterval) {
      this._lastVizTime = currentTime
      this._postVizData(inData)
    }

    return true
  }

  private _postVizData(rawInput: Float32Array): void {
    // AudioContext time is in seconds; this field is milliseconds (see the
    // `output` message above).
    const capturedAtMs = currentTime * 1000
    const vizPoints = 128
    const frames: StageFrameData[] = []

    // Use the most recent SPECTROGRAM_WINDOW_SIZE samples from the contiguous
    // spectrogram history (Spectro-style, ADR-032). A 4096-sample window at
    // 48 kHz gives ~85 ms time resolution with 2048 frequency bins - the
    // frequency axis is where real spectrogram detail lives. The renderer
    // (WebGL) displays this column per viz frame; the window's time history is
    // kept in the renderer's circular texture, not here.
    const specFrame = this._specHistory.window(SPECTROGRAM_WINDOW_SIZE)
    const spectrogram = spectrogramColumn(specFrame, {
      windowSize: SPECTROGRAM_WINDOW_SIZE,
      sampleRate: INTERNAL_SAMPLE_RATE,
    })
    const specData = {
      column: spectrogram.column,
      windowSize: spectrogram.windowSize,
      sampleRate: spectrogram.sampleRate,
    }

    // AEC stage (passthrough for v1): shows raw input. The metrics field
    // reserves the ERLE (echo return loss enhancement) slot for the future
    // AEC3 implementation; passthrough reports 0 dB (no suppression).
    frames.push({
      stageId: 'aec',
      kind: 'aec',
      capturedAtMs,
      waveform: downsampleForViz(rawInput, vizPoints),
      levelDb: levelDb(rawInput),
      spectrogram: specData,
      metrics: { erleDb: 0 },
    })

    // BSS stage (passthrough): same as AEC output. metrics reserves the
    // separation-quality slot (e.g. SI-SDR improvement) for the future
    // 2-mic beamforming implementation.
    frames.push({
      stageId: 'bss',
      kind: 'bss',
      capturedAtMs,
      levelDb: levelDb(rawInput),
      spectrogram: specData,
      metrics: { siSdrDb: 0 },
    })

    // NS stage: always use the last denoised frame (stable, no intermittent gaps).
    const nsFrame = this._hasNsFrame
      ? this._lastNsFrame
      : rawInput.subarray(0, Math.min(RNNOISE_FRAME_SIZE, rawInput.length))
    // NS shows its own denoised column from its own contiguous history.
    const nsSpectrogram = spectrogramColumn(this._nsSpecHistory.window(SPECTROGRAM_WINDOW_SIZE), {
      windowSize: SPECTROGRAM_WINDOW_SIZE,
      sampleRate: INTERNAL_SAMPLE_RATE,
    })
    frames.push({
      stageId: 'ns',
      kind: 'ns',
      capturedAtMs,
      waveform: downsampleForViz(nsFrame, vizPoints),
      levelDb: levelDb(nsFrame),
      spectrogram: {
        column: nsSpectrogram.column,
        windowSize: nsSpectrogram.windowSize,
        sampleRate: nsSpectrogram.sampleRate,
      },
    })

    this._post({ type: 'frame', frames })
  }
}

/** Concatenate Float32Array chunks into one buffer (epic #53 P5). */
function concatFloat32(chunks: Float32Array[]): Float32Array {
  let len = 0
  for (const c of chunks) len += c.length
  const out = new Float32Array(len)
  let off = 0
  for (const c of chunks) {
    out.set(c, off)
    off += c.length
  }
  return out
}

registerProcessor(PROCESSOR_NAME, PipelineProcessor)
