# kws-streaming (Google Research `kws_streaming`) - Module Specification

- **Status:** Draft (docs-first; awaiting human review)
- **Owner:** WakeStudio team
- **Plan phase:** Phase 2 (inference driver) + Phase 5 (training path)
- **Related ADRs:** ADR-011 (lazy model registry), ADR-017 (config panel),
  ADR-020 (pluggable KWS backends), ADR-024 (KWS categories + decoupling rule),
  ADR-025 (module platform), ADR-026 (testing layers), ADR-028 (uv train
  scripts), ADR-030 (engine + per-backend drivers), ADR-031 (training adapts to
  upstream scripts), ADR-032 (platform DSP)
- **Depends on (modules):** `kws-engine` (registry + `KWSBackend` seam), AFE
  (consumes the 16 kHz output stream)
- **Issue:** [#72](https://github.com/awareride/wake-studio/issues/72)
- **Last updated:** 2026-08-07

## 1. Purpose

`kws-streaming` is a **Traditional Fixed-Class KWS driver module** (ADR-024
§2.1) that runs models produced by Google Research's
[`kws_streaming`](https://github.com/google-research/google-research/blob/master/kws_streaming/README.md)
library (Apache-2.0; paper: *Streaming keyword spotting on mobile devices*,
arXiv:2005.06720).

The upstream library trains a KWS classifier with a **non-streaming** Keras
topology and then automatically converts it to a **streaming** inference graph
by inserting ring buffers into the time-dimension layers. WakeStudio consumes
the **external-state** flavour of that conversion: the resulting graph is
*stateless* — every streaming buffer is an explicit graph input and output — so
one 20 ms packet in, one posterior plus updated buffers out. That is exactly the
shape of `KWSBackend.processFrame()`, so the driver is a thin state-carrying
loop over onnxruntime-web with **no new runtime dependency**.

The module covers 9 streamable model families with one code path (`dnn`,
`dnn_raw`, `gru`, `lstm`, `cnn`, `crnn`, `ds_cnn`, `svdf`, `svdf_resnet`,
`ds_tc_resnet`, `bc_resnet`), because the architecture only changes the shapes
in the sidecar manifest (§4.2), never the loop.

Why this module exists (and is not "just another backend"):

- It is the first **Traditional training** integration. ADR-024 §2.1 promises
  "fully support the complete training & inference pipelines", and today only
  inference exists (via OpenWakeWord's pretrained classifiers).
  `docs/kws-categories.md` §6 lists the Traditional P0 projects as intent only.
- The models are **tiny** (10K-75K parameters at 96-98% accuracy on Speech
  Commands V2 12-label), which is the MCU/app-class export matrix (ADR-021).
- The upstream repo ships **code but no pretrained weights**, and the code is
  Apache-2.0. Anything trained from it is commercially clean and passes the
  Phase-4 license gate — unlike the openWakeWord demo classifiers
  (CC BY-NC-SA, demo-only).

## 2. Scope & boundaries

- **In scope:**
  - A `KWSStreamingBackend` implementing `KWSBackend`, self-registered into the
    engine registry with `category: 'traditional'`.
  - External-state streaming inference over onnxruntime-web: packet
    accumulation to the model's declared `packetSamples`, state tensors carried
    across `processFrame` calls, states zeroed on `reset()`.
  - A **sidecar manifest** (`model.json`, §4.2) that describes the exported
    graph: input/output names, state input↔output pairing, packet size, label
    list, and whether the speech feature extractor is inside the graph.
  - Label → posterior selection: pick the configured `wantedWord` column out of
    the multi-class softmax, so a 12-label Speech Commands model can act as a
    single-wake-word detector.
  - The `spec.train` block wiring the **unpatched upstream**
    `kws_streaming/train/model_train_eval.py` (ADR-031) plus a
    `standardize-results` adapter for its run directory.
  - The module's spec-driven panel (ADR-017/024 dual-layer) and L1 tests.
- **Out of scope:**
  - The generic detection loop (VAD gate, smoothing, threshold, min-duration,
    cooldown) — owned by `kws-engine` (ADR-030).
  - The AFE (this module consumes `AFEOutputFrame`).
  - **Shipping trained weights.** No model is registered in
    `model-registry.json` by this change; upstream ships none, and training one
    needs the Phase-5 runner. Until then the driver is
    `browserFeasible: true` but requires a user-supplied model (§7).
  - The TFLite→ONNX conversion **workflow**. §6.4 declares the intended build
    inputs, but the CI recipe lands with the first trained model.
  - Quantization-aware training and MCU deployment (Phase 4/5).
- **Public surface:** `KWSStreamingBackend` (via the engine registry),
  `KwsStreamingManifest` (the sidecar type), and the pure state-machine helpers
  (`createStateBag`, `advanceStates`, `selectLabelScore`) that the L1 tests
  cover without a model.

## 3. Dependencies

- **Upstream (consumes from):** AFE — `AFEOutputFrame` (16 kHz mono, 160
  samples / 10 ms), delivered by `kws-engine`'s worker loop.
- **Downstream (provides to):** `kws-engine` (as a `KWSBackend`); the UI reads
  the standard `KWSScoreSample` / `KWSTriggerEvent` shapes (ADR-024 §5.2 — the
  UI must not be able to tell which category fired).
- **External libraries / models** (see `LICENSES.md`):
  - **`google-research/kws_streaming`** (Apache-2.0) — the model definitions +
    training/conversion scripts. Used as a **pinned upstream script** at train
    time (ADR-031); never vendored, never forked.
  - **onnxruntime-web** (Apache-2.0) — already a dependency of the
    `kws-openwakeword` driver; reused here. No TFLite runtime is introduced:
    the upstream TFLite artifact is converted to ONNX at build time (§6.4).
  - **Speech Commands V1/V2** (`arXiv:1804.03209`, CC-BY-4.0) — the default
    training corpus. Downloaded by the training job, never bundled.
- **Numeric DSP:** if a model is exported with `preprocess: 'mfcc'`/`'micro'`
  (feature extractor *outside* the graph), the front-end is
  `@wake-studio/dsp` (ADR-032) — no hand-written mel/MFCC in this module. The
  **default and recommended** export is `preprocess: 'raw'` with
  `feature_type: 'mfcc_op'`, where the extractor is part of the graph and this
  module feeds raw samples.

## 4. Public API & types

### 4.1 The backend

```ts
import type { BackendModelUrls, KWSBackend } from '@wake-studio/module-kws-engine'

/**
 * Traditional fixed-class KWS over a kws_streaming external-state graph.
 *
 * The graph is stateless: `processFrame` feeds one packet plus the carried
 * state tensors and reads back logits plus the next state tensors. The engine
 * owns smoothing/trigger; this backend owns packet alignment + state carry.
 */
export class KWSStreamingBackend implements KWSBackend {
  readonly id: 'kws-streaming'
  readonly label: string
  readonly ready: boolean

  /** Load `urls.kwsStreaming` (model.onnx + model.json sidecar). */
  load(urls: BackendModelUrls, provider: 'webgpu' | 'wasm'): Promise<void>

  /**
   * Accumulate 10 ms AFE frames into the model's packet size, run one step per
   * whole packet, and return the posterior for the configured wanted word.
   * Returns null until the first whole packet is available (warmup).
   */
  processFrame(samples: Float32Array): Promise<number | null>

  /** Zero every state tensor (equivalent to upstream's `reset1` evaluation). */
  reset(): void
  dispose(): Promise<void>

  /** Panel-driven config (wanted word, label smoothing). */
  configure(cfg: Partial<KwsStreamingConfig>): void
}

export interface KwsStreamingConfig {
  /** Which label column is the wake word. Default: manifest.wantedWord. */
  wantedWord: string
  /**
   * Whether to reset states after a trigger. Upstream reports both
   * `reset0` (states kept, the paper's streaming number) and `reset1`
   * (states cleared per utterance). Default false = reset0 behaviour.
   */
  resetOnTrigger: boolean
}
```

### 4.2 The sidecar manifest (`model.json`)

The upstream conversion emits a graph whose input/output names and state shapes
depend on the architecture and on the training flags. Rather than hard-code any
of that, the **exporter writes a manifest next to the model** and the driver is
architecture-agnostic. This is the whole reason one driver serves 9 model
families.

```ts
export interface KwsStreamingManifest {
  /** Manifest schema version (bumped on breaking changes). */
  version: 1
  /** Upstream model name: 'dnn' | 'cnn' | 'ds_tc_resnet' | 'bc_resnet' | ... */
  model: string
  /** Commit of google-research/kws_streaming the model was trained from. */
  upstreamRef: string
  /** Class labels in output-column order (upstream `labels.txt`). */
  labels: string[]
  /** Default wake word; must be a member of `labels`. */
  wantedWord: string
  /** Sample rate the graph expects (upstream default 16000). */
  sampleRate: 16000
  /**
   * Samples per streaming step. Upstream aligns this with the total
   * stride/pooling in the time dimension (e.g. 320 = 20 ms at 16 kHz).
   * `processFrame` buffers AFE frames until a whole packet is available.
   */
  packetSamples: number
  /**
   * Where the speech feature extractor lives. 'graph' = upstream
   * preprocess 'raw' (mfcc_tf / mfcc_op inside the model, the recommended
   * export); 'external' = upstream preprocess 'mfcc'/'micro', which requires
   * an @wake-studio/dsp front-end (deferred, §11 Q-KS-2).
   */
  featureExtractor: 'graph' | 'external'
  /** The audio (or feature) input tensor name. */
  audioInput: string
  /** The logits/softmax output tensor name. */
  scoreOutput: string
  /**
   * Streaming state tensors, in graph order. Each entry pairs the state INPUT
   * with the state OUTPUT that feeds the next step, plus its shape so the
   * driver can allocate zeros without introspecting the graph.
   */
  states: Array<{ input: string; output: string; shape: number[] }>
  /** True when `scoreOutput` is already softmaxed (upstream default). */
  softmaxed: boolean
}
```

The engine's `BackendModelUrls` gains one optional member (an additive change
to the shared type — allowed; it does not alter existing behaviour):

```ts
export interface BackendModelUrls {
  // ...existing members
  kwsStreaming?: {
    /** The external-state streaming graph. */
    model: string
    /** The §4.2 sidecar manifest. */
    manifest: string
  }
}
```

### 4.3 Pure helpers (L1-testable, no model needed)

```ts
/** Allocate zero-filled state tensors from a manifest. */
export function createStateBag(m: KwsStreamingManifest): Map<string, Float32Array>

/** Copy step outputs into the next step's inputs (the state carry). */
export function advanceStates(
  m: KwsStreamingManifest,
  bag: Map<string, Float32Array>,
  outputs: Record<string, { data: Float32Array }>,
): void

/** Pick the wanted-word column, applying softmax when the graph did not. */
export function selectLabelScore(
  m: KwsStreamingManifest,
  logits: Float32Array,
  wantedWord: string,
): number
```

## 5. Data flow / sequence

The driver runs **inside the existing KWS Web Worker** (like `kws-openwakeword`,
unlike `kws-sherpa`): it is plain onnxruntime-web with no DOM dependency, so no
main-thread factory is registered.

```
AFE (AudioWorklet)          KWS Worker                        Main thread (UI)
      │                         │                                   │
      │ - AFEOutputFrame ------> │ engine: VAD gate                  │
      │   (160 samples/10 ms)    │ engine: backend.processFrame()    │
      │                         │   ├ append to packet buffer        │
      │                         │   ├ while (buffered >= packet):    │
      │                         │   │    run(audio + states)         │
      │                         │   │    advanceStates(outputs)      │
      │                         │   │    score = selectLabelScore()  │
      │                         │   └ return last score (or null)    │
      │                         │ engine: smooth + threshold         │
      │                         │ - KWSScoreSample ---------------->  │ score curve
      │                         │ - KWSTriggerEvent --------------->  │ trigger flash
```

Step by step:

1. **Load.** Fetch `model.json`, validate `version === 1` and that
   `wantedWord ∈ labels`, then fetch and instantiate `model.onnx`. Allocate the
   state bag from `manifest.states` (all zeros — a cold stream).
2. **Packet alignment.** AFE frames are 160 samples; the graph wants
   `packetSamples` (typically 320). Frames are appended to a small buffer and
   consumed in whole packets. Upstream is explicit that the streaming input
   length must be aligned with the total stride/pooling, so a partial packet is
   **never** fed — `processFrame` returns `null` instead.
3. **Step.** `run({ [audioInput]: packet, ...states })`. Read `scoreOutput` and
   every state output.
4. **State carry.** `advanceStates` copies each state output into its paired
   input for the next step. This is the whole point of the external-state mode:
   the graph itself holds nothing, so the driver's correctness is testable
   without a model (§9).
5. **Score.** `selectLabelScore` reads the `wantedWord` column (softmax first if
   `softmaxed === false`) and returns it as the raw posterior. The engine does
   the rest.
6. **Reset.** `reset()` zeroes the bag — upstream's `reset1` semantics. Whether
   a trigger also resets is a config flag (`resetOnTrigger`, default false =
   `reset0`, matching the accuracy numbers reported in the paper).

**Serialization guard:** as with `kws-openwakeword`, ONNX sessions are not
re-entrant. A frame arriving while a step is in flight is dropped (returns
`null`); the packet buffer keeps the audio it already holds, so state continuity
is preserved.

## 6. Configuration & constants

### 6.1 Panel parameters (ADR-017/024 dual layer)

| Parameter | Group | Default | Range | Notes |
|---|---|---|---|---|
| `modelSource` | primary | `custom` | `custom` | Where the graph comes from. Only user-supplied models exist until Phase 5 trains one (§2 out of scope). |
| `wantedWord` | primary | `""` (from manifest) | manifest labels | Which label column is the wake word. Populated from `model.json` after load. |
| `threshold` | primary | 0.5 | 0-1 | Detection threshold on the selected posterior (engine-applied). |
| `resetOnTrigger` | advanced | false | - | false = upstream `reset0` (states kept, the paper's streaming setting); true = `reset1`. |
| `executionProvider` | advanced | `wasm` | `webgpu` \| `wasm` | WASM by default: these graphs are tiny (10K-75K params), so WebGPU dispatch overhead dominates. |

### 6.2 Fixed constants

| Constant | Value | Notes |
|---|---|---|
| `sampleRate` | 16000 | Upstream default; the AFE already delivers 16 kHz. |
| AFE frame | 160 samples | 10 ms; buffered up to `manifest.packetSamples`. |
| `packetSamples` | from manifest | Typically 320 (20 ms), must match the graph's time stride. |

### 6.3 Training parameters (ADR-031, `spec.train`)

Upstream's `model_train_eval.py` is invoked **unmodified** with a pinned ref.
The panel exposes the flags below and passes them straight through; everything
else keeps upstream defaults.

| Flag | Default | Notes |
|---|---|---|
| model (positional) | `ds_tc_resnet` | 98.0% @ 75K params on V2/12-label. `bc_resnet` (30K) for MCU targets. |
| `--wanted_words` | `up,down` | Comma-separated target keywords; other folders become `unknown`. |
| `--data_dir` | `./data2/` | Speech Commands V2, or a custom `label/*.wav` tree. |
| `--split_data` | 1 | 0 when the user pre-split into `training/validation/testing`. |
| `--feature_type` | `mfcc_op` | FFT-based TFLite ops: smaller model, post-training quantization works. |
| `--preprocess` | `raw` | Feature extractor inside the model → the driver feeds raw audio. |
| `--how_many_training_steps` | `10000,10000,10000` | Upstream's staged schedule. |
| `--learning_rate` | `0.0005,0.0001,0.00002` | Paired with the staged steps. |

Outputs are read from the upstream run directory
(`tflite_stream_state_external/stream_state_external.tflite`, `labels.txt`,
`flags.json`) by the `standardize-results` adapter.

### 6.4 Build inputs (declared, recipe deferred)

`spec.build` declares the conversion the artifact needs, so the generic
`build.yaml` can run it once a trained checkpoint exists:

| Input | Default | Notes |
|---|---|---|
| `kws_streaming_ref` | `master` | Pinned commit of `google-research/kws_streaming`. |
| `model` | `ds_tc_resnet` | Which topology was trained. |
| `opset` | `18` | ONNX opset for the TFLite→ONNX conversion. |

## 7. Error model & failure modes

- **No model configured** (the default state until Phase 5): `load()` rejects
  with a message that names the module and points at the training panel —
  "kws-streaming ships no pretrained weights (upstream ships none); train one or
  supply model.onnx + model.json." This is an expected state, not a bug.
- **Manifest fetch/parse failure:** `load()` rejects before touching the graph,
  so a bad manifest can never produce a silently-wrong stream.
- **Manifest/graph mismatch** (a declared state or IO name is absent from the
  graph): `load()` rejects listing the missing names. Failing loudly here is
  deliberate — a mis-paired state tensor degrades accuracy silently, which is
  the single worst failure mode of external-state streaming.
- **`wantedWord` not in `labels`:** `load()` rejects; the panel repopulates the
  selector from the manifest.
- **`featureExtractor: 'external'`:** `load()` rejects with "not supported yet
  (Q-KS-2); re-export with `--preprocess raw`". Better an explicit gap than a
  half-correct MFCC front-end.
- **Non-streamable topology** (`att_rnn`, `att_mh_rnn`, `tc_resnet`,
  `mobilenet*`, `xception`, `inception*`): upstream cannot convert these to
  streaming, so no manifest can exist for them. The training panel filters the
  model list to the streamable set; the driver rejects an unknown
  `manifest.model`.
- **Step slower than realtime:** frames are dropped by the serialization guard
  (never queued), so audio never backs up. At 10K-75K parameters this is not
  expected.

## 8. Observability

- Reuses the shared KWS score curve + trigger flash (ADR-024 §5.2: the UI
  cannot distinguish categories).
- Dev panel additions: model name + `upstreamRef` from the manifest, packet
  size, step time (ms), steps/sec, state-bag byte size, and the full label
  vector (all class posteriors, not just the wanted word) — the multi-class view
  is the fastest way to see a model confusing the wake word with a neighbour.

## 9. Testing strategy

- **L1 (Vitest, no model):**
  - Spec integrity: `meta.id`, category, declared train/build blocks, params.
  - `createStateBag` — shapes, zero-fill, total size.
  - `advanceStates` — the state carry is the correctness core, so it is tested
    against a fake step: given synthetic outputs, the next inputs must equal
    them, and mis-paired names must throw.
  - `selectLabelScore` — column selection, softmax when `softmaxed: false`,
    clamping, unknown-label rejection.
  - Manifest validation — every §7 rejection path.
  - Decoupling: the existing `kws-engine` `decoupling.test.ts` list is extended
    with this driver, so an engine→driver import fails CI.
- **L2 (Node):** deferred until a model artifact exists (there is nothing to
  boot yet). Declared in the spec as a gap, not silently omitted.
- **L3 (Playwright):** deferred with L2, for the same reason.
- **Manual:** once trained — speak the wanted word, confirm the score rises and
  a trigger fires; confirm the score curve is continuous across packet
  boundaries (a state-carry bug shows up as a sawtooth).

## 10. Security & privacy

- Inference is 100% client-side; audio never leaves the browser (R2). Only
  posteriors reach the UI.
- User-supplied models are read from the lazy registry / a local file; nothing
  is uploaded.
- Training runs on a backend the user chose (ADR-013): self-hosted, their own
  cloud credentials, or their own Colab session. WakeStudio operates no server.
- Speech Commands is downloaded by the training job from Google's public
  endpoint over HTTPS; the CC-BY-4.0 attribution is recorded in `LICENSES.md`.

## 11. Open questions

- **[Q-KS-1] Which model do we train and ship as the Traditional baseline?**
  `ds_tc_resnet` (98.0%, 75K) is the accuracy pick; `bc_resnet_2` (97.6%, 30K)
  and `bc_resnet_1` (96.4%, ~10K) are the MCU picks. Proposal: `bc_resnet_2` as
  the shipped default (it is the best accuracy-per-byte for the ADR-021 target
  matrix) with `ds_tc_resnet` as the app-class option.
- **[Q-KS-2] Do we support `preprocess: 'mfcc'`/`'micro'` exports?** These put
  the feature extractor *outside* the graph, so the driver would need an
  `@wake-studio/dsp` MFCC front-end bit-matched to upstream's TFLite ops. It
  matters for MCU parity (the `micro` path is the TFLite-Micro one), but for the
  browser `preprocess: 'raw'` is strictly simpler. Proposal: reject for now,
  revisit with the device SDK.
- **[Q-KS-3] TFLite→ONNX, or a TFLite runtime in the browser?** Converting
  (`tf2onnx`) keeps one runtime (onnxruntime-web, already vendored) but risks
  op-coverage gaps on the streaming graph. Adding `@tensorflow/tfjs` (already
  listed conditionally in `LICENSES.md`) would run the TFLite artifact directly
  at the cost of a second inference stack in the bundle. Proposal: convert to
  ONNX; fall back to tfjs only if conversion proves unreliable.
- **[Q-KS-4] Does `kws_streaming` deserve its own training panel, or does it
  extend the existing `training` module?** ADR-024 §4.2 gives Traditional a
  training panel; this module would be its first real backend. Proposal: keep
  the panel in the `training` module and let this module contribute only its
  `spec.train` block, so we do not grow a second training UI.

## 12. References

- Upstream: [`kws_streaming/README.md`](https://github.com/google-research/google-research/blob/master/kws_streaming/README.md);
  paper *Streaming keyword spotting on mobile devices* (arXiv:2005.06720);
  MatchboxNet (arXiv:2004.08531); BC-ResNet (arXiv:2106.04140);
  Speech Commands (arXiv:1804.03209).
- ADR-020 (pluggable backends), ADR-024 (categories + decoupling), ADR-030
  (engine + drivers), ADR-031 (upstream training scripts), ADR-032 (DSP).
- Related module docs: `docs/modules/kws.md` (the engine contract),
  `docs/modules/training.md` (the training-job interface),
  `docs/kws-categories.md` §2.1 (the Traditional category).
- Issue: [#72](https://github.com/awareride/wake-studio/issues/72).

## 13. Change log

| Date | Change | Author |
|---|---|---|
| 2026-08-07 | Initial draft (docs-first, pending human review) — Traditional-category driver for `google-research/kws_streaming` external-state streaming graphs (#72). | agent |
