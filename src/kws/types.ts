/**
 * KWS module - shared types and message protocol.
 *
 * Public API surface: see docs/modules/kws.md §4.
 * Contract is locked (ADR-018); implementation follows.
 */

// ---------------------------------------------------------------------------
// Public API types (docs/modules/kws.md §4)
// ---------------------------------------------------------------------------

/** KWS detection mode. */
export type KWSMode = 'traditional' | 'few-shot-scaffold'

/** One score sample emitted per inference frame (~every 10 ms). */
export interface KWSScoreSample {
  /** AudioContext.currentTime at capture (from the AFE frame). */
  capturedAtMs: number
  /** Raw model posterior [0,1]. */
  rawScore: number
  /** Smoothed score (sliding-window max, §6). */
  smoothedScore: number
  /** Whether the trigger condition is currently met (threshold + min-duration). */
  triggered: boolean
  /** VAD probability [0,1] (from the AFE's RNNoise VAD, ADR-018). */
  vadProbability: number
}

/** A wake-word trigger event. */
export interface KWSTriggerEvent {
  /** AudioContext.currentTime when the trigger fired. */
  triggeredAtMs: number
  /** Peak smoothed score at the trigger point. */
  peakScore: number
  /** The detected wake word / model name. */
  word: string
}

/** Full KWS configuration; every field has a default (ADR-017 config panel). */
export interface KWSConfig {
  mode: KWSMode
  threshold: number
  minDurationMs: number
  smoothingWindowFrames: number
  vadGateEnabled: boolean
  vadThreshold: number
  cooldownMs: number
  executionProvider: 'webgpu' | 'wasm'
}

/** Descriptor for one tunable parameter (shared with AFE, ADR-017). */
export interface ParameterDescriptor {
  id: string
  label: string
  type: 'number' | 'boolean' | 'select'
  default: number | boolean | string
  min?: number
  max?: number
  step?: number
  options?: ReadonlyArray<{ value: string; label: string }>
  unit?: string
  description: string
}

/** Runtime status of the KWS engine. */
export type KWSStatus = 'idle' | 'loading' | 'ready' | 'running' | 'error'

// ---------------------------------------------------------------------------
// Message protocol (worker <-> main thread)
// ---------------------------------------------------------------------------

/** Messages sent from the main thread to the worker. */
export type KWSWorkerMessage =
  | { type: 'load'; models: ModelUrls }
  | { type: 'config'; config: KWSConfig }
  | {
      type: 'audio'
      samples: Float32Array
      capturedAtMs: number
      vadProbability: number
    }
  | { type: 'embed'; requestId: number; samples: Float32Array; sampleRate: number }
  | { type: 'stop' }

/** Messages sent from the worker to the main thread. */
export type KWSMainMessage =
  | { type: 'loaded'; executionProvider: 'webgpu' | 'wasm' }
  | { type: 'score'; sample: KWSScoreSample }
  | { type: 'trigger'; event: KWSTriggerEvent }
  | { type: 'embed-result'; requestId: number; embedding: Float32Array }
  | { type: 'error'; message: string }

/** URLs for the ONNX models (from the model registry, ADR-011). */
export interface ModelUrls {
  melspectrogram: string
  embedding: string
  classifier: string
  wavlm?: string
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class KWSLoadError extends Error {
  constructor(message = 'Failed to load KWS models.') {
    super(message)
    this.name = 'KWSLoadError'
  }
}

export class KWSUnsupportedError extends Error {
  constructor(message = 'KWS inference is unavailable in this browser.') {
    super(message)
    this.name = 'KWSUnsupportedError'
  }
}
