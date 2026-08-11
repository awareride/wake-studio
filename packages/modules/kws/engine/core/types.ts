/**
 * KWS module - shared types and message protocol.
 *
 * Public API surface: see docs/modules/kws.md §4.
 * Contract is locked (ADR-018); implementation follows.
 */

// ---------------------------------------------------------------------------
// Public API types (docs/modules/kws.md §4)
// ---------------------------------------------------------------------------

import type { ModelRuntime } from '@wake-studio/platform'
import { DEFAULT_MODEL_RUNTIME } from '@wake-studio/platform'
/**
 * Pluggable KWS backend identifiers (ADR-020). The engine delegates inference
 * to a `KWSBackend` adapter; selection is per-target / per-word.
 */
/**
 * KWS functional category (ADR-024 §2). Unlike ModuleSpec.meta.category
 * (module type: afe/kws/few-shot/...), this is the product-level KWS
 * taxonomy that drives the panel's behavior: Traditional (train+inference),
 * ASR-Decoding (inference + editable text word list), Few-Shot
 * (inference + audio-sample enrollment). A driver declares its category at
 * registration; hosts branch on it instead of on backend ids.
 */
export type KWSBackendCategory = 'traditional' | 'asr-decoding' | 'few-shot'

export type KWSBackendId =
  | 'openwakeword' // mel -> speech_embedding -> classifier (app-class)
  | 'microwakeword' // TFLite-Micro streaming CNN (MCU; not browser-feasible v1)
  | 'plixkws' // PLiX Few-Shot (compact CNN encoder + prototype distance; edge-friendly)
  | 'sherpa-onnx-kws' // Direct keyword spotting via sherpa-onnx KWS wasm (transducer)
  | 'kws-streaming' // google-research/kws_streaming external-state streaming graph (Traditional)
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
  /**
   * Global model-runtime hint (ADR-002 amendment). Applies to every model the
   * engine loads unless a per-URL `runtime` override is present. Defaults to
   * {@link DEFAULT_MODEL_RUNTIME} ('onnx').
   */
  runtime?: ModelRuntime
}

/** Descriptor for one tunable parameter (shared with AFE, ADR-017). */
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

export interface BackendModelUrls {
  melspectrogram?: string
  embedding?: string
  classifier?: string
  plixkws?: string
  /**
   * kws-streaming driver: an exported `kws_streaming` external-state streaming
   * graph plus its sidecar manifest (which declares tensor names, state
   * shapes, packet size and labels). @see docs/modules/kws-streaming.md §4.2
   */
  kwsStreaming?: {
    /** The external-state streaming graph (.onnx). */
    model: string
    /** The sidecar manifest (model.json). */
    manifest: string
  }
  /** Model-runtime hint for the model(s) addressed by these URLs. @see ModelRuntime */
  runtime?: ModelRuntime
}

/**
 * Configuration for the sherpa-onnx KWS wasm backend (backend id
 * `'sherpa-onnx-kws'`). The model files (encoder/decoder/joiner/tokens) are
 * prebuilt into the wasm `.data` bundle (see build-sherpa-onnx-kws-wasm.yml),
 * so only the wasm base URL and the keyword list are configurable.
 */
export interface SherpaOnnxKwsConfig {
  /** Base URL where sherpa-onnx-kws.{js,wasm,data} are served. */
  wasmBaseUrl: string
  /**
   * sherpa-onnx keyword list. Each line is `spaced tokens @display name`,
   * e.g. `x iǎo ài t óng x ué @小爱同学`. Defaults to the bundled model's
   * keywords when omitted.
   */
  keywords?: string
  /** Number of decode threads (wasm is single-threaded; keep at 1). */
  numThreads?: number
  /** Per-keyword score threshold (0..1) passed to sherpa-onnx. */
  keywordsThreshold?: number
}

/** Re-export so call sites can stay within the kws module if they prefer. */
export type { ModelRuntime }
export const DEFAULT_RUNTIME = DEFAULT_MODEL_RUNTIME

/** Runtime status of the KWS engine. */
export type KWSStatus = 'idle' | 'loading' | 'ready' | 'running' | 'error'

// ---------------------------------------------------------------------------
// Message protocol (worker <-> main thread)
// ---------------------------------------------------------------------------

/** Messages sent from the main thread to the worker. */
export type KWSWorkerMessage =
  | {
      type: 'load'
      backend: KWSBackendId
      models: BackendModelUrls
      prototype?: number[]
      /** Negative-class prototype (plixkws open-set rejection, issue #69). */
      prototypeNegative?: number[]
      /**
       * Driver-specific backend config (e.g. plixkws windowMs /
       * useNegativePrototype). Passed through to the backend's init
       * (epic #53 P1) - currently only main-thread backends (sherpa)
       * consume backendConfig directly.
       */
      backendConfig?: unknown
    }
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
  | { type: 'partial'; text: string }
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
