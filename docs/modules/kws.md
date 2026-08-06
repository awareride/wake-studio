# KWS (Keyword Spotting) - Module Specification

- **Status:** Accepted (human review complete; ADR-018 + ADR-020 + ADR-030)
- **Owner:** WakeStudio team
- **Plan phase:** Phase 2; module-migration §6.3 (engine + driver modules)
- **Related ADRs:** ADR-001 (pipeline stages), ADR-002 (PLiX Few-Shot encoder), ADR-011 (lazy model registry), ADR-017 (per-component config panel), ADR-018 (KWS Phase 2 design decisions), ADR-020 (pluggable KWS backends), ADR-024 (KWS categories), ADR-030 (engine + per-backend drivers)
- **Depends on (modules):** AFE (consumes the 16 kHz output stream)
- **Last updated:** 2026-08-05

## 0. Module layout (ADR-030)

The KWS layer is an **engine module + per-backend driver modules** (NOT one
module):

| Module | What it is | Location |
|---|---|---|
| `kws-engine` | KWSEngine, worker loop, `KWSBackend` interface, registry seam | `packages/modules/kws/engine/` |
| `kws-openwakeword` | mel→embedding→classifier driver | `packages/modules/kws/openwakeword/` |
| `kws-sherpa` | main-thread transducer driver (wasm in module assets) | `packages/modules/kws/sherpa/` |
| `kws-plix` | EmbedProvider + prototype-distance + encoder variants | `packages/modules/kws/plix/` |

Drivers self-register via `registerKwsBackend` (sherpa via `mainThreadFactory`,
plix via the embed-provider factory) - adding a backend never edits the engine
(ADR-024).

## 1. Purpose

The KWS module detects a wake word in real time from the AFE's processed 16 kHz
output stream. It runs model inference in the browser (onnxruntime-web for
OpenWakeWord / PLiX; emscripten-compiled WASM for sherpa-onnx KWS), smooths the
posterior score, applies a threshold + minimum-duration rule, and raises a
trigger event. It also provides the Few-Shot `embed(audio)` function (frozen
PLiX encoder) for Phase 3 enrollment. Delivers the KWS half of the in-browser
experience (requirement R5).

## 2. Scope & boundaries

- **In scope:** a pluggable `KWSBackend` interface (ADR-020) with adapters;
  onnxruntime-web integration (WebGPU + WASM fallback); the OpenWakeWord backend
  (melspectrogram -> embedding -> classifier); the **sherpa-onnx KWS backend**
  (transducer keyword spotter, emscripten WASM on the main thread); score
  smoothing (sliding window); threshold + min-duration trigger logic; VAD gating
  via the AFE's RNNoise VAD; live score-curve visualization; the Few-Shot
  `embed(audio)` scaffold (load PLiX, extract embeddings - matching is Phase 3);
  KWS config panel (ADR-017). Backend selection is exposed in the panel
  (openWakeWord and sherpa-onnx KWS are browser-feasible; micro-wake-word /
  PocketSphinx are registered for the device SDK (ADR-021) but not browser-
  feasible; PLiX Few-Shot is Phase 3, created by the worker with an enrolled
  prototype).
- **Out of scope:** Few-Shot enrollment + prototype matching (Phase 3); model
  export (Phase 4); model training (Phase 5); the AFE pipeline itself (Phase 1 -
  KWS consumes its output). The former ASR-Decoding (`asr-decode`) backend was
  removed in 2026-07-31 (ba52a61) - a broken heuristic over an ASR decoder - and
  is replaced by sherpa-onnx KWS (see `docs/kws-categories.md` §2.2).
- **Public surface:** a `KWSEngine` controller the UI drives (load model, start/stop
  detection, subscribe to scores/triggers, configure threshold/min-duration) and an
  `embed(audio)` function for Phase 3.

## 3. Dependencies

- **Upstream (consumes from):** AFE module - `AFEPipeline.onOutput()` provides
  `AFEOutputFrame` (16 kHz mono, 160 samples / 10 ms).
- **Downstream (provides to):** UI (score curve + trigger events); Phase 3
  Few-Shot enrollment (consumes `embed(audio)`).
- **External libraries / models** (see `LICENSES.md`, `model-registry.json`):
  - **onnxruntime-web** (Apache-2.0) - the ONNX inference runtime (WebGPU + WASM). Used by OpenWakeWord and by the PLiX **ONNX** runtime.
  - **@xenova/transformers** (Apache-2.0) - optional runtime for the PLiX **transformers** path (browser-native `feature-extraction`, no `.onnx` file). Dynamically imported only when `plixkwsRuntime: "transformers"` is selected; declared as an `optionalDependency` (see `pckage.json`).
  - **openWakeWord melspectrogram** (`melspectrogram.onnx`, Apache-2.0) - 16 kHz
    log-Mel front-end. Commercially clean.
  - **Google speech_embedding** (`embedding_model.onnx`, Apache-2.0) - frozen
    feature backbone (~1.4M params). Commercially clean.
  - **Demo classifier model** - the **hey-buddy** model
    (`benjamin-paine/hey-buddy`, CC-BY-4.0, commercially clean) for the Phase 2
    in-browser demo. Replaces the originally-planned openWakeWord `alexa.onnx`
    (CC BY-NC-SA, demo-only); see ADR-018 Q-KWS-1 amendment. The same pipeline
    (mel -> speech-embedding -> classifier) is used; only the classifier weights
    differ.
  - **PLiX Few-Shot encoder** (`plixkws`, Apache-2.0) - compact CNN
    (EfficientNet-v2 "base" / TinyNet-E "small") trained as a Prototypical
    Network; outputs a 1280-dim embedding for prototype-distance matching.
    Loaded via the KWS module's `PlixKwsEmbedProvider`. Replaces WavLM-base-plus
    (too heavy for end-side devices). See `LICENSES.md`.
    **Runtime-pluggable:** served via ONNX (onnxruntime-web, default) or
    browser-native via `@xenova/transformers` (no `.onnx` file; zero-Python
    deployment). The runtime is the GLOBAL `ModelRuntime` type (see `src/runtime.ts`),
    so it can be set per model and extended to other backends (e.g. `executorch`)
    without touching each module. See `docs/Technical Reference_ Resource
    Requirements and Zero-Python Deployment Strategies for WavLM-base-plus and
    plixkws.md` §3.
  - **VAD**: the AFE's RNNoise VAD score (already in `AFEOutputFrame.vadActive`)
    is used for KWS gating for v1 (ADR-018). Silero VAD (ONNX, MIT) is deferred to
    v1.x when more accurate gating is needed.

  The other registered backends (ADR-020) - **micro-wake-word** (Apache-2.0,
  MCU/TFLite-Micro), **PLiX Few-Shot** (Apache-2.0, Phase 3), and **PocketSphinx**
  (BSD, lightweight HMM/GMM) - are not browser-feasible in v1 and have no
  browser adapter yet; they are part of the interface so the SDK (ADR-021) and
  later phases can implement them.

## 4. Public API & types

This is the contract the UI and Phase 3 rely on. The ONNX session / Web Worker
internals are implementation details below this surface (sketched in §5).

```ts
import type { AFEOutputFrame } from '../afe'

/**
 * Pluggable KWS backend identifiers (ADR-020). The engine delegates inference
 * to a `KWSBackend` adapter; selection is per-target / per-word.
 */
export type KWSBackendId =
  | 'openwakeword'   // mel -> speech_embedding -> classifier (app-class)
  | 'microwakeword'  // TFLite-Micro streaming CNN (MCU; not browser-feasible v1)
  | 'plixkws'        // PLiX embedding + prototype-distance (app-class; Phase 3)
  | 'sherpa-onnx-kws' // Direct keyword spotting via sherpa-onnx KWS wasm (transducer)
  | 'pocketsphinx'   // lightweight HMM/GMM (MCU+; WASM port pending)

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
  /** VAD probability [0,1] (from Silero or the AFE's RNNoise VAD). */
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
  backend: KWSBackendId          // default 'openwakeword' (ADR-020)
  threshold: number              // default 0.5 (0-1)
  minDurationMs: number          // default 500 (score must exceed threshold for this long)
  smoothingWindowFrames: number  // default 10 (~1 s at 10 ms/frame; sliding-window max)
  vadGateEnabled: boolean        // default true (skip inference when VAD < threshold)
  vadThreshold: number           // default 0.3 (VAD probability below which KWS is gated)
  cooldownMs: number             // default 2000 (min time between triggers)
  executionProvider: 'webgpu' | 'wasm'  // default 'webgpu' with 'wasm' fallback
  runtime?: ModelRuntime         // global model-runtime hint (ADR-002 amendment)
}

/** sherpa-onnx KWS backend configuration (see packages/modules/kws/engine/core/types.ts). */
export interface SherpaOnnxKwsConfig {
  /** Base URL where sherpa-onnx-kws.{js,wasm,data} are served. */
  wasmBaseUrl: string
  /**
   * sherpa-onnx keyword list; each line is `spaced tokens @display name`
   * (e.g. `x iǎo ài t óng x ué @小爱同学`). Defaults to the bundled model's
   * keywords when omitted.
   */
  keywords?: string
  /** Number of decode threads (wasm is single-threaded; keep at 1). */
  numThreads?: number
  /** Per-keyword score threshold (0..1) passed to sherpa-onnx. */
  keywordsThreshold?: number
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
 * model-specific inference and its own audio windowing/buffering.
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
  /**
   * Optional capability: sherpa-onnx KWS streams partial keyword detections;
   * the backend emits them as detections (KWSEngine may convert to scores).
   */
  onDetection?: (cb: (word: string) => void) => () => void
  /** Apply sherpa-onnx-specific config before load(). */
  configure?(cfg: Partial<SherpaOnnxKwsConfig>): void
}

/** Optional capability: extract a speaker embedding for Few-Shot (Phase 3). */
export interface EmbedProvider {
  embed(audio: Float32Array, sampleRate: number): Promise<Float32Array>
}

/** Model URLs a backend needs (from the registry, ADR-011). Subset by backend. */
export interface BackendModelUrls {
  melspectrogram?: string
  embedding?: string
  classifier?: string
  plixkws?: string
  sherpaKws?: {
    js: string
    wasm: string
    data: string
  }
}

/** Top-level controller the UI drives. */
export interface KWSEngine {
  /** Load models from the registry (ADR-011). Resolves when ready to detect. */
  load(): Promise<void>
  /** Start detection. Subscribes to the AFE output stream. */
  start(afe: { onOutput: (cb: (f: AFEOutputFrame) => void) => () => void }): void
  stop(): void
  readonly running: boolean
  readonly ready: boolean

  /** Subscribe to per-frame score samples. Returns an unsubscribe function. */
  onScore(cb: (sample: KWSScoreSample) => void): () => void
  /** Subscribe to trigger events. Returns an unsubscribe function. */
  onTrigger(cb: (event: KWSTriggerEvent) => void): () => void

  /** Current configuration (ADR-017). */
  readonly config: KWSConfig
  setConfig(patch: Partial<KWSConfig>): void
  describeParameters(): ReadonlyArray<ParameterDescriptor>

  /** Few-Shot scaffold (Phase 3): extract a PLiX embedding from audio. */
  embed(audio: Float32Array, sampleRate: number): Promise<Float32Array>
}
```

## 5. Data flow / sequence

**Threading (ADR-018, amended 2026-07-31):** ONNX-based backends (OpenWakeWord,
PLiX) run inference in a **Web Worker** (off-main-thread) to avoid blocking the
UI; the main thread owns the `KWSEngine` controller and visualization, the worker
owns the ONNX sessions + inference loop, and they communicate via `postMessage`.
The **sherpa-onnx KWS backend deviates**: its classic emscripten glue requires
`document` (it drives `Module.onRuntimeInitialized` and expects DOM shims), so
it runs on the **main thread** and drives its own smoothing/trigger loop there
(see `packages/modules/kws/sherpa/core/backend.ts` + the engine's `KWSEngine`). Both paths expose the
same `onScore`/`onTrigger` events to the UI.

```
AFE (AudioWorklet)                KWS Worker (ONNX backends)   Main thread (UI)
      │                               │                            │
      │ -- AFEOutputFrame (16kHz) --> │                            │
      │                               │ -- VAD gate                │
      │                               │ -- backend.processFrame    │
      │                               │   (mel->embed->classifier) │
      │                               │ -- smooth + threshold      │
      │                               │                            │
      │                               │ -- KWSScoreSample -------> │ (score curve)
      │                               │ -- KWSTriggerEvent ------> │ (trigger flash)
      │                               │                            │
      │                       <-- config (threshold, etc.) ------- │
```

**KWS inference loop (per AFE output frame, ~10 ms):**

1. **VAD gate:** if `vadGateEnabled` and VAD probability < `vadThreshold`, skip
   inference for this frame (saves compute, suppresses false alarms in silence).
   VAD source: the AFE's RNNoise VAD (`AFEOutputFrame.vadActive`, ADR-018).
2. **VAD gate:** if `vadGateEnabled` and VAD probability < `vadThreshold`, the
   frame's *trigger is suppressed* (not the inference). Inference always runs so
   the backend's sliding audio window stays current - RNNoise's VAD is
   conservative at utterance onset, and skipping inference would drop the first
   phonemes of the wake word. VAD source: the AFE's RNNoise VAD
   (`AFEOutputFrame.vadActive`, ADR-018).
3. **Backend inference:** call `KWSBackend.processFrame(samples)`. The backend
   owns its own audio windowing/buffering and model pipeline; for the OpenWakeWord
   backend that is accumulate -> `melspectrogram.onnx` -> `embedding_model.onnx`
   -> classifier -> raw posterior [0,1]. Returns `null` during warmup (not enough
   audio yet); the engine treats null as "no score this frame."
3. **Smooth:** push the raw score into a sliding window of
   `smoothingWindowFrames` frames; `smoothedScore` = max of the window.
4. **Trigger logic:** if `smoothedScore >= threshold` for >= `minDurationMs`
   consecutive frames, and the cooldown period has elapsed since the last trigger,
   fire a `KWSTriggerEvent`.

**Few-Shot scaffold:** `embed(audio)` loads the PLiX encoder (ONNX), runs it
on the audio, and returns the embedding vector. Phase 3 uses this for prototype
matching (cosine similarity). The scaffold proves the encoder loads and runs in the
browser; matching/triggering is Phase 3.

## 6. Configuration & constants

All parameters are surfaced in the **Studio config panel** with the defaults below
(ADR-017). Each is declared via `describeParameters()` (§4).

| Parameter | Default | Range | Notes |
|---|---|---|---|
| `backend` | `openwakeword` | `openwakeword` \| `microwakeword` \| `plixkws` \| `sherpa-onnx-kws` \| `pocketsphinx` | Pluggable KWS backend (ADR-020). Browser-feasible: `openwakeword`, `sherpa-onnx-kws`; `plixkws` (Phase 3, needs enrollment); `microwakeword` / `pocketsphinx` are export-only (ADR-021). |
| `threshold` | 0.5 | 0-1 | Smoothed score must exceed this to trigger. |
| `minDurationMs` | 500 | 100-3000 | Score must exceed threshold for this long to trigger. |
| `smoothingWindowFrames` | 10 | 1-30 | Sliding-window size for max-pooling (~10 ms/frame). |
| `vadGateEnabled` | true | - | Suppress triggers (not inference) when VAD < threshold; keeps the audio window current. |
| `vadThreshold` | 0.3 | 0-1 | VAD probability below which KWS is gated. |
| `cooldownMs` | 2000 | 500-10000 | Minimum time between triggers. |
| `executionProvider` | `webgpu` | `webgpu` \| `wasm` | WebGPU first; WASM fallback if unsupported. sherpa-onnx-kws is always WASM (emscripten build). |
| `runtime` | `onnx` | `onnx` \| `transformers` | Global model-runtime hint (ADR-002 amendment) for ONNX-based backends. |
| `melWindowSize` | 1280 | fixed | Melspectrogram window in samples (80 ms @ 16 kHz). |
| `melHopSize` | 160 | fixed | Melspectrogram hop (10 ms @ 16 kHz = 1 AFE frame). |

**sherpa-onnx KWS backend parameters** (`SherpaOnnxKwsConfig`, set via
`engine.load(..., sherpaKwsConfig)`):

| Parameter | Default | Notes |
|---|---|---|
| `wasmBaseUrl` | `/sherpa-onnx-kws/` | Where `sherpa-onnx-kws.{js,wasm,data}` are served (ADR-011 lazy fetch; gitignored, see `docs/build-artifacts.md`). |
| `keywords` | bundled model's | `spaced tokens @display name` lines override the model's built-in keyword list. |
| `numThreads` | 1 | WASM is single-threaded; keep at 1. |
| `keywordsThreshold` | model default | Per-keyword score threshold (0..1) passed to sherpa-onnx. |

> **Trigger tuning:** `threshold` + `minDurationMs` + `cooldownMs` form the
> false-alarm / false-reject trade-off. Lower threshold + shorter duration = more
> sensitive (more false alarms); higher threshold + longer duration = more
> conservative (more false rejects). The config panel lets users tune live.

## 7. Error model & failure modes

- **Model fetch failure** (network/CORS): `load()` rejects with a descriptive
  error; UI shows "failed to load KWS models - check connection." Models are
  fetched lazily from the registry (ADR-011).
- **sherpa-onnx KWS assets missing** (the ~55 MB
  `packages/modules/kws/sherpa/assets/sherpa-onnx-kws/*`
  bundle is gitignored, ADR-011): `load()` rejects with a message pointing at
  `node scripts/fetch-artifact.mjs kws-sherpa` (see `docs/build-artifacts.md`).
- **ONNX session creation failure** (unsupported op, WASM unavailable): `load()`
  rejects; UI shows "KWS inference unavailable in this browser."
- **WebGPU unavailable:** automatic fallback to WASM execution provider; UI shows
  a "performance" indicator (WASM is slower).
- **PLiX embedder (Few-Shot / Phase 3):** the PLiX ONNX graph contains ops
  (notably `Concat` with int64 shape tensors) that onnxruntime-web's WebGPU EP
  fails to compile, raising a cascade of `Invalid ComputePipeline "Concat"`
  WebGPU validation errors at `run()` time. The `PlixKwsEmbedProvider` is
  therefore pinned to the **WASM** execution provider regardless of the
  configured `executionProvider`. The reported EP is `wasm` whenever only the
  PLiX embedder is loaded; OpenWakeWord detection backends still use WebGPU
  where available. (Fix: force WASM for the embedder, report `wasm` as the
  effective EP in the few-shot-only case.)
- **Inference slower than realtime** (frame underrun): drop the oldest frames,
  log a warning, surface via the score-curve (gaps); never block the audio thread.
- **WavLM / PLiX too large for browser memory** (Phase 3 concern): `embed()` rejects with
  an out-of-memory error; UI suggests closing other tabs. Mitigation: the PLiX
  encoder is a compact CNN (far smaller than the old WavLM-base-plus); a
  distilled "small" variant is documented (ADR-002).

## 8. Observability

- **Live score curve:** raw + smoothed score plotted over time (scrolling canvas,
  like the AFE level curve); the threshold line is drawn for reference.
- **Trigger flash:** a visual pulse + optional audio beep when a trigger fires.
- **VAD indicator:** the VAD probability is shown alongside the score curve (gated
  frames are dimmed).
- **Dev panel:** inference time per frame (ms), frames/sec, model load time,
  current execution provider (WebGPU/WASM), VAD gate skip rate.

## 9. Testing strategy

- **Unit (Vitest):** the pure logic - score smoothing (sliding-window max),
  threshold + min-duration trigger logic, cooldown, VAD gate. These are extracted
  to a testable module (like `afe/graph/dsp.ts`, itself delegating to
  `@wake-studio/dsp` ADR-032) with no ONNX dependency.
- **WASM runtime test (L2, Node):** load the sherpa-onnx-kws emscripten bundle in
  a Node process (the glue supports `ENVIRONMENT=node`), instantiate the
  `KeywordSpotter`, and run one inference pass over a synthetic clip. Fast, runs
  on every PR; catches wasm/model regressions before the slow browser e2e.
- **Integration (browser):** load a real model in Playwright; feed a test audio
  clip and assert the score rises on the wake word and stays low on silence.
- **Manual / on-device:** speak the demo wake word -> confirm a trigger fires
  with < 500 ms latency; adjust threshold/min-duration sliders -> confirm
  behavior changes predictably; confirm VAD silences KWS during silence.
- **e2e (Playwright):** `e2e/sherpa-kws.spec.ts` asserts the sherpa-onnx-kws
  backend boots in the browser (wasm initializes + KeywordSpotter created,
  status becomes `ready`, `EP: WASM` label renders). Slow (~55 MB wasm fetch),
  so it runs at a lower cadence than L1/L2 (see testing ADR).

## 10. Security & privacy

- All inference is **100% client-side**; audio never leaves the browser (R2). The
  KWS worker receives audio frames from the AFE (same origin, in-memory).
- Models are fetched over HTTPS from the lazy registry (ADR-011); the CSP must
  allow `wasm-unsafe-eval` for onnxruntime-web's WASM backend.
- No wake-word audio is recorded or transmitted; only the posterior score is
  emitted to the UI. `embed(audio)` is called only on demand (Phase 3 enrollment).
- WebGPU/WASM feature detection ensures the app degrades gracefully without
  transmitting device fingerprints.

## 11. Resolved decisions

All Phase 2 open questions are resolved (ADR-018); the contract is locked.

- **[Q-KWS-1] Demo model -> `hey-buddy`** (`benjamin-paine/hey-buddy`, CC-BY-4.0,
  commercially clean) (ADR-018, amended). Originally planned as openWakeWord
  `alexa.onnx` (CC BY-NC-SA, demo-only); switched to hey-buddy because it is
  commercially clean and browser-first, so the demo model can also serve as a
  redistributable export baseline (no license-gate friction). The Phase 4 license
  gate still applies to any CC-BY-NC-SA model that might be added later.
- **[Q-KWS-2] Inference thread -> Web Worker** (ADR-018). Off-main-thread to
  avoid blocking the UI; the main thread owns the controller + visualization.
- **[Q-KWS-3] Execution provider -> WebGPU-first with WASM fallback** (ADR-018).
  Feature-detect `navigator.gpu`; fall back to WASM automatically. The config
  panel exposes the choice.
- **[Q-KWS-4] VAD source -> AFE's RNNoise VAD** (ADR-018). The AFE already
  provides `vadActive` in `AFEOutputFrame` (free, no extra model). Silero VAD is
  deferred to v1.x. The plan's "Silero VAD integration" task is superseded by
  "VAD gating via AFE's RNNoise VAD."
- **[ADR-020] Pluggable KWS backends.** KWS is a `KWSBackend` interface with
  adapters (openWakeWord, micro-wake-word, PLiX Few-Shot, PocketSphinx). The
  engine delegates inference to the selected backend; only `openwakeword` has a
  browser adapter in v1. This makes the in-browser demo and the device-side SDK
  (ADR-021) share one interface.

## 12. References

- Plan: §4.1 Domain B (KWS models), §4.3 (inference stack), Phase 2 tasks/validation.
- ADR-001 (pipeline stages), ADR-002 (PLiX Few-Shot encoder), ADR-011 (lazy model registry),
  ADR-017 (per-component config panel), ADR-018 (KWS Phase 2 design decisions),
  ADR-020 (pluggable KWS backends).
- Upstream: onnxruntime-web; openWakeWord (`dscripka/openWakeWord`); PLiX
  (`aaqibsaeed/plixkws`); Silero VAD (`snakers4/silero-vad`).
- Model registry: `public/model-registry.json` (melspectrogram, speech_embedding,
  openwakeword-alexa, plixkws, silero-vad).
- Related module docs: `docs/modules/afe.md` (Phase 1, upstream provider - AFE
  output is KWS input); `docs/modules/few-shot.md` (Phase 3, downstream consumer
  of `embed(audio)` - not yet written).

## 13. Change log

| Date | Change | Author |
|---|---|---|
| 2026-07-27 | Initial draft (docs-first, pending human review). | agent |
| 2026-07-27 | Human review: resolved Q-KWS-1..4 (ADR-018). Status -> Accepted. | agent |
| 2026-07-27 | ADR-020: add `KWSBackend` pluggable-interface contract (§4/§5/§6/§11); docs-sync demo model to hey-buddy (CC-BY-4.0, matches shipped code + registry). | agent |
| 2026-07-27 | Implement the §7 serialization guard: drop frames during in-flight inference (ONNX sessions are not re-entrant; "Session already started"). | agent |
| 2026-07-27 | Fix the OpenWakeWord pipeline: correct mel output shape `[1,1,time,32]` (was misread as `[time,1,76,32]`), add the required `x/10+2` melspectrogram transform, window 76 mel FRAMES (not per-timestep) for the embedding model, use 480-sample streaming overlap. Post 0-scores during ~2 s warmup so the curve renders. | agent |
| 2026-07-28 | VAD gate now suppresses triggers, not inference. The old gate dropped audio frames during VAD-off, losing wake-word onset (RNNoise VAD is conservative) and making triggering difficult. Inference always runs so the audio window stays current. | agent |
| 2026-07-28 | Migrate the Few-Shot encoder from WavLM-base-plus to **PLiX** (`aaqibsaeed/plixkws`, Apache-2.0). WavLM-base-plus was too heavy for end-side devices; PLiX is a compact CNN (EfficientNet-v2 "base" / TinyNet-E "small") with Prototypical-Network scoring (embedding -> mean prototype -> distance). New `plixkws` backend id + `PlixKwsEmbedProvider` (log-Mel front-end, WASM-pinned). Scoring uses squared-Euclidean distance to the prototype, rescaled to [0,1] via `1/(1+d^2)`. Replaces `wavlm-few-shot` / `WavLMEmbedProvider`. | agent |
| 2026-07-31 | Add `sherpa-onnx-kws` backend (real KWS transducer, emscripten WASM, main-thread) to the backend union, `KWSBackend` optional `onDetection`/`configure`, `SherpaOnnxKwsConfig`, `BackendModelUrls.sherpaKws`, `KWSConfig.runtime`. Threading §5 amended (sherpa runs main-thread), config table + error model + testing strategy updated. Docs-only sync with ba52a61. | agent |
