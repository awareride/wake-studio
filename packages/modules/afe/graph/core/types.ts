/**
 * AFE module - shared types and message protocol.
 *
 * Public API surface: see docs/modules/afe.md §4.
 * Contract is locked (ADR-016/017); implementation follows.
 */

// ---------------------------------------------------------------------------
// Public API types (docs/modules/afe.md §4)
// ---------------------------------------------------------------------------

/** A named AFE stage in the fixed pipeline (ADR-001). */
export type AFEStageKind = 'aec' | 'bss' | 'ns'

/** AFE topology: how the stage DSP cores are wired (ADR-016). */
export type AFETopology = 'single-worklet' | 'node-per-stage'

/** Per-engine processing frame size in ms (ADR-016; configurable per engine). */
export interface FrameConfig {
  aec: number
  bss: number
  ns: number
}

/** Full AFE configuration; every field has a default (surfaced in the config
 *  panel, ADR-017). */
export interface AFEConfig {
  topology: AFETopology
  channels: 1 | 2
  frameMs: FrameConfig
  latencyBudgetMs: number
  vizFps: number
}

/**
 * Microphone source options for {@link AFEPipeline.start} (epic #53 P2).
 * Browser DSP toggles are surfaced per-device in the input-source selector;
 * defaults keep the current behavior (browser DSP off — our RNNoise is the
 * only NS; default device).
 */
export interface MicSourceConfig {
  /** Preferred input device id (default device when omitted). */
  deviceId?: string
  echoCancellation?: boolean
  noiseSuppression?: boolean
  autoGainControl?: boolean
  channelCount?: 1 | 2
}

/**
 * File source config for {@link AFEPipeline.start} (epic #53 P3). The host
 * (web app) decodes the files and builds one AudioBufferSourceNode per active
 * channel, mixing them (mono) before handing the nodes here; the pipeline just
 * wires them into the worklet. `dispose` stops all sources when the pipeline
 * stops.
 */
export interface FileSourceConfig {
  /** One source node per active channel (already mixed to mono if > 1). */
  nodes: AudioNode[]
  /** Stop / release the file sources (called on AFE stop). */
  dispose: () => void
}

/** Union of accepted pipeline input sources (mic or file). */
export type PipelineSource = MicSourceConfig | FileSourceConfig

/** Descriptor for one tunable parameter, used to build the Studio config panel
 *  (ADR-017). Every module exposes its parameters this way. */
export interface ParameterDescriptor {
  id: string
  label: string
  type: 'number' | 'boolean' | 'select' | 'string'
  default: number | boolean | string
  min?: number
  max?: number
  step?: number
  options?: ReadonlyArray<{ value: string; label: string }>
  unit?: string
  description: string
}

/** One magnitude-spectrogram column (Spectro-style, ADR-032). */
export interface SpectrogramData {
  /** Magnitude bins, bin 0 = DC, last = Nyquist (length windowSize/2). */
  column: Float32Array
  /** FFT window size in samples (default 4096). */
  windowSize: number
  /** Sample rate the column was computed at (48 kHz AFE). */
  sampleRate: number
}

/** Per-frame visualization data emitted by a stage (throttled to vizFps). */
export interface StageFrameData {
  stageId: string
  kind: AFEStageKind
  /** Capture time in MILLISECONDS (AudioContext.currentTime * 1000). */
  capturedAtMs: number
  /** Downsampled time-domain samples for the waveform display. */
  waveform?: Float32Array
  /** RMS level in dBFS. */
  levelDb?: number
  /** VAD probability [0,1] (from RNNoise for v1, ADR-016). */
  vadProbability?: number
  /**
   * Magnitude spectrum for the spectrogram display (NS stage).
   * @deprecated Replaced by `spectrogram` (Spectro-style column, ADR-032).
   */
  spectrum?: Float32Array
  /** Spectro-style spectrogram column (time axis lives in the renderer). */
  spectrogram?: SpectrogramData
  /** Stage-specific metrics. */
  metrics?: Record<string, number>
}

/** One processed output frame delivered to downstream KWS (Phase 2). */
export interface AFEOutputFrame {
  /** 16 kHz mono samples for one 10 ms frame (160 samples). */
  samples: Float32Array
  /**
   * Capture time in MILLISECONDS (`AudioContext.currentTime * 1000`).
   *
   * Milliseconds, not seconds: the KWS trigger compares this against
   * `minDurationMs` / `cooldownMs`. It used to carry raw seconds, which meant
   * the trigger needed 300 *seconds* of continuous speech and so never fired.
   */
  capturedAtMs: number
  vadActive: boolean
}

/** A recorded audio clip (raw + processed) for offline A/B replay. */
export interface RecordedClip {
  raw: Float32Array
  processed: Float32Array
  sampleRate: number
  durationMs: number
}

/** Runtime status of a single AFE stage. */
export type StageStatus = 'ok' | 'bypassed' | 'degraded' | 'failed'

export interface StageState {
  id: string
  kind: AFEStageKind
  status: StageStatus
  bypassed: boolean
}

// ---------------------------------------------------------------------------
// Message protocol (worklet <-> main thread)
// ---------------------------------------------------------------------------

/** Messages sent from the worklet to the main thread. */
export type WorkletMessage =
  | { type: 'ready' }
  | { type: 'frame'; frames: StageFrameData[] }
  | { type: 'output'; samples: Float32Array; capturedAtMs: number; vad: number }
  | { type: 'recorded'; raw: Float32Array; processed: Float32Array; sampleRate: number }
  | {
      /**
       * A chunk of the persistent per-stage capture (epic #53 P5). Sent
       * repeatedly while `persist` recording is active; the main thread
       * appends it to the clip buffer. `stage` identifies raw / processed
       * (NS), matching the workspace persistence stages.
       */
      type: 'record-chunk'
      stage: 'raw' | 'processed'
      samples: Float32Array
      sampleRate: number
    }
  | { type: 'record-end' }
  | { type: 'error'; message: string }

/** Messages sent from the main thread to the worklet. */
export type MainMessage =
  | {
      type: 'config'
      bypass: { aec: boolean; bss: boolean; ns: boolean }
      vizFps: number
    }
  | { type: 'absource'; source: 'raw' | 'processed' }
  | {
      type: 'record'
      seconds: number
      /**
       * When true, stream chunks via `record-chunk` instead of the one-shot
       * `recorded` promise (epic #53 P5 persistent capture).
       */
      persist?: boolean
    }
  | { type: 'stop' }

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class MicPermissionError extends Error {
  constructor(message = 'Microphone permission denied or unavailable.') {
    super(message)
    this.name = 'MicPermissionError'
  }
}

export class UnsupportedBrowserError extends Error {
  constructor(
    message = 'AudioWorklet is not supported. Use Chrome, Firefox, or Edge.',
  ) {
    super(message)
    this.name = 'UnsupportedBrowserError'
  }
}
