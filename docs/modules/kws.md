# KWS (Keyword Spotting) - Module Specification

- **Status:** Draft (docs-first - pending human review before implementation)
- **Owner:** WakeStudio team
- **Plan phase:** Phase 2
- **Related ADRs:** ADR-001 (pipeline stages), ADR-002 (WavLM encoder), ADR-011 (lazy model registry), ADR-017 (per-component config panel)
- **Depends on (modules):** AFE (consumes the 16 kHz output stream)
- **Last updated:** 2026-07-27

## 1. Purpose

The KWS module detects a wake word in real time from the AFE's processed 16 kHz
output stream. It runs ONNX inference in the browser (onnxruntime-web), smooths
the posterior score, applies a threshold + minimum-duration rule, and raises a
trigger event. It also scaffolds the Few-Shot `embed(audio)` function (frozen
WavLM encoder) for Phase 3 enrollment. Delivers the KWS half of the in-browser
experience (requirement R5).

## 2. Scope & boundaries

- **In scope:** onnxruntime-web integration (WebGPU + WASM fallback); Traditional
  KWS inference (openWakeWord-style: melspectrogram -> embedding -> classifier);
  score smoothing (sliding window); threshold + min-duration trigger logic; Silero
  VAD gating; live score-curve visualization; the Few-Shot `embed(audio)` scaffold
  (load WavLM, extract embeddings - matching is Phase 3); KWS config panel
  (ADR-017).
- **Out of scope:** Few-Shot enrollment + prototype matching (Phase 3); model
  export (Phase 4); model training (Phase 5); the AFE pipeline itself (Phase 1 -
  KWS consumes its output).
- **Public surface:** a `KWSEngine` controller the UI drives (load model, start/stop
  detection, subscribe to scores/triggers, configure threshold/min-duration) and an
  `embed(audio)` function for Phase 3.

## 3. Dependencies

- **Upstream (consumes from):** AFE module - `AFEPipeline.onOutput()` provides
  `AFEOutputFrame` (16 kHz mono, 160 samples / 10 ms).
- **Downstream (provides to):** UI (score curve + trigger events); Phase 3
  Few-Shot enrollment (consumes `embed(audio)`).
- **External libraries / models** (see `LICENSES.md`, `model-registry.json`):
  - **onnxruntime-web** (Apache-2.0) - the ONNX inference runtime (WebGPU + WASM).
  - **openWakeWord melspectrogram** (`melspectrogram.onnx`, Apache-2.0) - 16 kHz
    log-Mel front-end. Commercially clean.
  - **Google speech_embedding** (`embedding_model.onnx`, Apache-2.0) - frozen
    feature backbone (~1.4M params). Commercially clean.
  - **Demo classifier model** - see [Q-KWS-1]: the openWakeWord `alexa.onnx`
    (CC BY-NC-SA, demo-only) is the simplest option; a permissively-licensed or
    self-trained model is the clean option.
  - **WavLM-base-plus** (`wavlm-base-plus-int8`, MIT) - frozen Few-Shot encoder
    (~95M params, int8 ~95 MB). Scaffolded for Phase 3.
  - **Silero VAD** (`silero-vad.onnx`, MIT) - voice activity detection for KWS
    gating. See [Q-KWS-4] (may defer to v1.x if the AFE's RNNoise VAD suffices).

## 4. Public API & types

This is the contract the UI and Phase 3 rely on. The ONNX session / Web Worker
internals are implementation details below this surface (sketched in §5).

```ts
import type { AFEOutputFrame } from '../afe'

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
  mode: KWSMode                  // default 'traditional'
  threshold: number              // default 0.5 (0-1)
  minDurationMs: number          // default 500 (score must exceed threshold for this long)
  smoothingWindowFrames: number  // default 10 (~1 s at 10 ms/frame; sliding-window max)
  vadGateEnabled: boolean        // default true (skip inference when VAD < threshold)
  vadThreshold: number           // default 0.3 (VAD probability below which KWS is gated)
  cooldownMs: number             // default 2000 (min time between triggers)
  executionProvider: 'webgpu' | 'wasm'  // default 'webgpu' with 'wasm' fallback
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

  /** Few-Shot scaffold (Phase 3): extract a WavLM embedding from audio. */
  embed(audio: Float32Array, sampleRate: number): Promise<Float32Array>
}
```

## 5. Data flow / sequence

**Threading (ADR-018, proposed):** KWS inference runs in a **Web Worker**
(off-main-thread) to avoid blocking the UI. The main thread owns the `KWSEngine`
controller and visualization; the worker owns the ONNX sessions + inference loop.
They communicate via `postMessage` (scores/triggers out, config in). Rationale:
ONNX inference on a ~1.4M-param model at 10 ms/frame can take 2-10 ms per frame;
running it on the main thread risks janky viz. The AFE's AudioWorklet already runs
off-main-thread; KWS follows the same principle.

```
AFE (AudioWorklet)                KWS Worker                  Main thread (UI)
      │                               │                            │
      │ -- AFEOutputFrame (16kHz) --> │                            │
      │                               │ -- accumulate mel window   │
      │                               │ -- melspectrogram.onnx     │
      │                               │ -- embedding_model.onnx    │
      │                               │ -- classifier.onnx         │
      │                               │ -- smooth + threshold      │
      │                               │ -- VAD gate                │
      │                               │                            │
      │                               │ -- KWSScoreSample -------> │ (score curve)
      │                               │ -- KWSTriggerEvent ------> │ (trigger flash)
      │                               │                            │
      │                       <-- config (threshold, etc.) ------- │
```

**Traditional KWS inference loop (per AFE output frame, ~10 ms):**

1. **Accumulate:** buffer incoming 16 kHz frames until a melspectrogram window is
   full (openWakeWord uses 1280 samples = 80 ms per mel frame, with 10 ms hops).
2. **VAD gate:** if `vadGateEnabled` and VAD probability < `vadThreshold`, skip
   inference for this frame (saves compute, suppresses false alarms in silence).
   VAD source: see [Q-KWS-4].
3. **Melspectrogram:** run `melspectrogram.onnx` on the audio window -> mel
   features.
4. **Embedding:** run `embedding_model.onnx` on the mel features -> embedding
   vector.
5. **Classifier:** run the word model (e.g. `alexa.onnx`) on the embedding ->
   raw posterior [0,1].
6. **Smooth:** push the raw score into a sliding window of
   `smoothingWindowFrames` frames; `smoothedScore` = max of the window.
7. **Trigger logic:** if `smoothedScore >= threshold` for >= `minDurationMs`
   consecutive frames, and the cooldown period has elapsed since the last trigger,
   fire a `KWSTriggerEvent`.

**Few-Shot scaffold:** `embed(audio)` loads WavLM-base-plus (int8 ONNX), runs it
on the audio, and returns the embedding vector. Phase 3 uses this for prototype
matching (cosine similarity). The scaffold proves the encoder loads and runs in the
browser; matching/triggering is Phase 3.

## 6. Configuration & constants

All parameters are surfaced in the **Studio config panel** with the defaults below
(ADR-017). Each is declared via `describeParameters()` (§4).

| Parameter | Default | Range | Notes |
|---|---|---|---|
| `mode` | `traditional` | `traditional` \| `few-shot-scaffold` | Traditional = openWakeWord-style; few-shot-scaffold = WavLM embed only (Phase 3 prep). |
| `threshold` | 0.5 | 0-1 | Smoothed score must exceed this to trigger. |
| `minDurationMs` | 500 | 100-3000 | Score must exceed threshold for this long to trigger. |
| `smoothingWindowFrames` | 10 | 1-30 | Sliding-window size for max-pooling (~10 ms/frame). |
| `vadGateEnabled` | true | - | Skip inference when VAD < threshold (saves compute). |
| `vadThreshold` | 0.3 | 0-1 | VAD probability below which KWS is gated. |
| `cooldownMs` | 2000 | 500-10000 | Minimum time between triggers. |
| `executionProvider` | `webgpu` | `webgpu` \| `wasm` | WebGPU first; WASM fallback if unsupported. |
| `melWindowSize` | 1280 | fixed | Melspectrogram window in samples (80 ms @ 16 kHz). |
| `melHopSize` | 160 | fixed | Melspectrogram hop (10 ms @ 16 kHz = 1 AFE frame). |

> **Trigger tuning:** `threshold` + `minDurationMs` + `cooldownMs` form the
> false-alarm / false-reject trade-off. Lower threshold + shorter duration = more
> sensitive (more false alarms); higher threshold + longer duration = more
> conservative (more false rejects). The config panel lets users tune live.

## 7. Error model & failure modes

- **Model fetch failure** (network/CORS): `load()` rejects with a descriptive
  error; UI shows "failed to load KWS models - check connection." Models are
  fetched lazily from the registry (ADR-011).
- **ONNX session creation failure** (unsupported op, WASM unavailable): `load()`
  rejects; UI shows "KWS inference unavailable in this browser."
- **WebGPU unavailable:** automatic fallback to WASM execution provider; UI shows
  a "performance" indicator (WASM is slower).
- **Inference slower than realtime** (frame underrun): drop the oldest frames,
  log a warning, surface via the score-curve (gaps); never block the audio thread.
- **WavLM too large for browser memory** (Phase 3 concern): `embed()` rejects with
  an out-of-memory error; UI suggests closing other tabs. Mitigation: int8
  quantization (~95 MB); a distilled fallback is documented (ADR-002).

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
  to a testable module (like `afe/dsp.ts`) with no ONNX dependency.
- **Integration:** load a real ONNX model in a jsdom/Node environment with
  onnxruntime-node (CI) or a browser (Playwright); feed a test audio clip and
  assert the score rises on the wake word and stays low on silence.
- **Manual / on-device:** speak the demo wake word -> confirm a trigger fires with
  < 500 ms latency; adjust threshold/min-duration sliders -> confirm behavior
  changes predictably; confirm VAD silences KWS during silence.
- **e2e (Playwright):** assert the KWS panel renders and the score curve is
  visible after model load (audio-level trigger testing is manual).

## 10. Security & privacy

- All inference is **100% client-side**; audio never leaves the browser (R2). The
  KWS worker receives audio frames from the AFE (same origin, in-memory).
- Models are fetched over HTTPS from the lazy registry (ADR-011); the CSP must
  allow `wasm-unsafe-eval` for onnxruntime-web's WASM backend.
- No wake-word audio is recorded or transmitted; only the posterior score is
  emitted to the UI. `embed(audio)` is called only on demand (Phase 3 enrollment).
- WebGPU/WASM feature detection ensures the app degrades gracefully without
  transmitting device fingerprints.

## 11. Open questions

- **[Q-KWS-1] Demo model choice.** The openWakeWord `alexa.onnx` (CC BY-NC-SA,
  demo-only) is the simplest demo model - already in the registry, marked
  `class: demo-only`. Alternatively, train/find a permissively-licensed model
  first (Phase 5's job). Recommendation: **use alexa.onnx for the Phase 2 demo**
  (it's not exported commercially; the license gate blocks export), and note that
  Phase 5 trains a clean replacement. Confirm.
- **[Q-KWS-2] Inference thread: Web Worker vs main thread.** Recommendation: **Web
  Worker** (off-main-thread) to avoid blocking the UI during inference. This adds
  a `postMessage` hop (~1 ms) but keeps the score curve smooth. Confirm; if
  confirmed, this becomes ADR-018.
- **[Q-KWS-3] Execution provider: WebGPU-first vs WASM-only for v1.** WebGPU is
  faster but less widely supported (Chrome/Edge only; Firefox/Safari lag).
  Recommendation: **WebGPU-first with automatic WASM fallback** (feature-detect
  `navigator.gpu`). The config panel exposes the choice. Confirm.
- **[Q-KWS-4] VAD source: Silero VAD vs AFE's RNNoise VAD.** The AFE already
  provides `vadActive` (from RNNoise's VAD score) in `AFEOutputFrame`. Loading
  Silero VAD (a separate ONNX model + inference) adds ~2 MB + compute. Recommendation:
  **use the AFE's RNNoise VAD for v1** (it's already computed, free); defer Silero
  VAD to v1.x when we need more accurate gating for KWS. Confirm; if confirmed,
  update the plan's Phase 2 task ("Silero VAD integration") to "VAD gating via
  AFE's RNNoise VAD (Silero deferred to v1.x)."

## 12. References

- Plan: §4.1 Domain B (KWS models), §4.3 (inference stack), Phase 2 tasks/validation.
- ADR-001 (pipeline stages), ADR-002 (WavLM encoder), ADR-011 (lazy model registry),
  ADR-017 (per-component config panel).
- Upstream: onnxruntime-web; openWakeWord (`dscripka/openWakeWord`); WavLM
  (`microsoft/wavlm-base-plus`); Silero VAD (`snakers4/silero-vad`).
- Model registry: `public/model-registry.json` (melspectrogram, speech_embedding,
  openwakeword-alexa, wavlm-base-plus-int8, silero-vad).
- Related module docs: `docs/modules/afe.md` (Phase 1, upstream provider - AFE
  output is KWS input); `docs/modules/few-shot.md` (Phase 3, downstream consumer
  of `embed(audio)` - not yet written).

## 13. Change log

| Date | Change | Author |
|---|---|---|
| 2026-07-27 | Initial draft (docs-first, pending human review). | agent |
