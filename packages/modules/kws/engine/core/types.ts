/**
 * KWS module - shared types and message protocol.
 *
 * Public API surface: see docs/modules/kws.md §4.
 * Contract is locked (ADR-018); implementation follows.
 */

// ---------------------------------------------------------------------------
// Public API types (docs/modules/kws.md §4)
// ---------------------------------------------------------------------------

import type { ModelRegistry, ModelRuntime } from '@wake-studio/platform'
import { DEFAULT_MODEL_RUNTIME } from '@wake-studio/platform'
import type {
  ModuleSpec,
  ProvisionArtifact,
  ProvisionKind,
} from '@wake-studio/contracts'
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
  /**
   * Raw per-word scores (label -> [0,1]) for the last frame (ADR-039).
   * Present when the active backend can provide per-word posteriors (e.g.
   * a multi-class kws-streaming model); absent for single-word backends.
   */
  wordScores?: Record<string, number>
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
  /**
   * Configured wake words (ADR-039): the host's multi-word selector. Each
   * word the user enables is shown as its own score curve (when the backend
   * provides {@link KWSScoreSample.wordScores}). Shared threshold/smoothing
   * across words (human decision 2026-08-18).
   */
  words?: string[]
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
  /**
   * Optional (ADR-039): per-word raw scores (label -> [0,1]) for the last
   * processed frame, or null when the backend is single-word. The engine
   * threads these into {@link KWSScoreSample.wordScores} so hosts can draw a
   * score curve per wake word. Optional, so existing backends are untouched.
   */
  readonly wordScores?: Record<string, number> | null
  /**
   * Optional (ADR-039): the wake-word labels this backend can detect — the
   * options for the host's multi-word selector (e.g. a multi-class model's
   * labels, an ASR keyword list). Optional; single-word backends omit it.
   */
  readonly labels?: string[]
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
  /**
   * Model-runtime hint for the model(s) addressed by these URLs.
   * @see ModelRuntime
   */
  runtime?: ModelRuntime
  /**
   * Driver-opaque URL bag (ADR-034): each driver owns its URL shape and
   * interprets its keys at the load boundary - its `resolveModelUrls` returns
   * this shape and its `backend.load` reads the keys it declared (e.g.
   * openwakeword reads `melspectrogram`/`embedding`/`classifier`, plix reads
   * `plixkws`, kws-streaming reads `kwsStreaming`). The engine never reads a
   * driver-named key; the only engine-known field is `runtime` above. Adding
   * a driver never edits this type (ADR-024/034).
   */
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// Backend registration extras (ADR-024/025): host-facing declarations.
//
// Drivers declare these at registration time so the host panel renders the
// Model-source editor, the Engine-card resources and the load URL mapping
// generically - adding a backend never edits the host.
// ---------------------------------------------------------------------------

/** One model role the Model-source editor offers for a backend. */
export interface ModelSourceRole {
  /** Role key; also the modelSources/customUrls map key in the host. */
  role: string
  /** Label shown in the Model-source editor. */
  label: string
  /** Registry model id used when the user has not selected anything. */
  fallbackId: string
}

/** Context handed to a backend's resolveModelUrls() (ADR-024). */
export interface BackendModelResolveContext {
  /** The loaded platform model registry (ADR-011). */
  registry: ModelRegistry
  /** The driver's own param values (spec params), keyed by id. */
  driverValues: Record<string, unknown>
  /** User model-source selection per role: registry id | 'custom' | 'user:<id>'. */
  modelSources: Record<string, string | undefined>
  /** Custom URLs per role (when the user selected 'custom'). */
  customUrls: Record<string, string>
  /** Blob URLs for user-library models (role -> blob URL). */
  userBlobUrls: Record<string, string>
}

/** Readiness/detail computed by a driver's resource-row probe. */
export interface BackendResourceState {
  ready: boolean
  /** Detail line shown under the row label (e.g. URL, sample count). */
  detail?: string
}

/** Context handed to a backend's resource-row state() probe. */
export interface BackendResourceStateContext {
  /** Current engine status (idle | loading | ready | running | error). */
  status: KWSStatus
  /** Model URLs of the current load (BackendModelUrls). */
  urls: BackendModelUrls
  /** The driver's own param values (spec params), keyed by id. */
  driverValues: Record<string, unknown>
  /**
   * Persisted artifacts the host has loaded (e.g. few-shot prototypes and
   * sample counts). Shape is driver-defined; the probe reads what it
   * declared. Empty when the host has no artifacts for this backend.
   */
  saved: Record<string, unknown>
}

/**
 * One resource row in the host's Engine card: a model the backend loads or
 * persistent data the user has created. Declared per driver at registration
 * so adding a backend never edits the host panel.
 */
export interface BackendResourceDescriptor {
  id: string
  label: string
  kind: 'model' | 'data'
  /**
   * 'model' rows: key into BackendModelUrls whose loaded URL is shown. The
   * bag is driver-opaque (ADR-034), so the key is a plain string the driver
   * declared.
   */
  urlKey?: string
  /**
   * 'data' rows (or custom model rows): driver-owned readiness/detail. When
   * absent on a 'model' row, the host derives readiness from engine status
   * and detail from the loaded URL.
   */
  state?: (ctx: BackendResourceStateContext) => BackendResourceState
}

// ---------------------------------------------------------------------------
// Provisioning capability (ADR-033).
//
// Producing "the wake-word artifact a backend needs" (enrolled prototype /
// keyword list / trained classifier) is one abstract behavior with different
// input collection per driver. The pure payload types live in contracts
// (ProvisionKind / ProvisionArtifact); this interface binds them to engine
// types. Hosts render the capability's spec, collect input, call produce(),
// persist the artifact, then feed apply() into engine.load - the host never
// branches on a backend id.
// ---------------------------------------------------------------------------

/**
 * A backend's provisioning capability (ADR-033). Optional on the
 * registration; traditional backends (openwakeword, sherpa, kws-streaming)
 * omit it and keep the plain resolveModelUrls -> engine.load path.
 */
export interface ProvisionCapability {
  /** Which artifact kind this capability produces. */
  kind: ProvisionKind
  /**
   * Provisioning panel spec (ADR-025) - rendered by the generator, host stays
   * generic. Declares the collect/produce actions + status (e.g. record,
   * enroll, start) and any input params.
   */
  spec?: ModuleSpec
  /**
   * Run the provisioning: mic samples / dataset / keyword text in, artifact
   * out. The input shape is driver-defined (see the capability's spec).
   */
  produce(input: unknown): Promise<ProvisionArtifact>
  /**
   * Feed the artifact into engine.load: resolved model URLs and/or driver
   * backend config. For few-shot the artifact's prototype vector(s) ride in
   * backendConfig (opaque to the host, read by the worker's load handler).
   */
  apply(artifact: ProvisionArtifact): {
    urls?: BackendModelUrls
    backendConfig?: Record<string, unknown>
  }
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
