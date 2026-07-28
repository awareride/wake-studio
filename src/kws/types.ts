/**
 * KWS module - shared types and message protocol.
 *
 * Public API surface: see docs/modules/kws.md §4.
 * Contract is locked (ADR-018); implementation follows.
 */

// ---------------------------------------------------------------------------
// Public API types (docs/modules/kws.md §4)
// ---------------------------------------------------------------------------

/**
 * Pluggable KWS backend identifiers (ADR-020). The engine delegates inference
 * to a `KWSBackend` adapter; selection is per-target / per-word.
 */
export type KWSBackendId =
  | 'openwakeword' // mel -> speech_embedding -> classifier (app-class)
  | 'microwakeword' // TFLite-Micro streaming CNN (MCU; not browser-feasible v1)
  | 'plixkws' // PLiX Few-Shot (compact CNN encoder + prototype distance; edge-friendly)
  | 'pocketsphinx' // lightweight HMM/GMM (MCU+; WASM port pending)

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
  backend: KWSBackendId
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

/**
 * A pluggable KWS inference backend (ADR-020). The engine owns the generic
 * loop (VAD gate, smoothing, trigger, threading); the backend owns the
 * model-specific inference and its own audio windowing/buffering. Implemented
 * by browser adapters here and by the device-side SDK (ADR-021) in C/C++.
 */
export interface KWSBackend {
  readonly id: KWSBackendId
  readonly label: string
  /** Load the backend's models. Resolves when ready to process frames. */
  load(urls: BackendModelUrls, provider: 'webgpu' | 'wasm'): Promise<void>
  readonly ready: boolean
  /**
   * Process one AFE frame (160 samples / 10 ms @ 16 kHz). Returns a raw
   * posterior [0,1], or null during warmup (not enough audio accumulated).
   */
  processFrame(samples: Float32Array): Promise<number | null>
  /** Reset internal state (e.g. on stop). */
  reset(): void
  /** Release model resources. */
  dispose(): Promise<void>
}

/** Optional capability: extract a speaker embedding for Few-Shot (Phase 3). */
export interface EmbedProvider {
  readonly ready: boolean
  embed(audio: Float32Array, sampleRate: number): Promise<Float32Array>
}

/**
 * Model URLs a backend needs (from the registry, ADR-011). All optional - each
 * backend validates the subset it requires.
 */
export interface BackendModelUrls {
  melspectrogram?: string
  embedding?: string
  classifier?: string
  plixkws?: string
}

/** Runtime status of the KWS engine. */
export type KWSStatus = 'idle' | 'loading' | 'ready' | 'running' | 'error'

// ---------------------------------------------------------------------------
// Message protocol (worker <-> main thread)
// ---------------------------------------------------------------------------

/** Messages sent from the main thread to the worker. */
export type KWSWorkerMessage =
  | { type: 'load'; backend: KWSBackendId; models: BackendModelUrls; prototype?: number[] }
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
