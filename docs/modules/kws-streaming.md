# kws-streaming (Google Research `kws_streaming`) - Module Specification

- **Status:** Pilot (pretrained weights working in the web console; open
  questions below still need human review)
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
- **Last updated:** 2026-08-10

## 1. Purpose

`kws-streaming` is a **Traditional Fixed-Class KWS driver module** (ADR-024
§2.1) that runs models produced by Google Research's
[`kws_streaming`](https://github.com/google-research/google-research/blob/master/kws_streaming/README.md)
library (Apache-2.0; paper: *Streaming keyword spotting on mobile devices*,
arXiv:2005.06720).

The upstream library trains a KWS classifier with a **non-streaming** Keras
topology and can then automatically convert it to a **streaming** inference
graph by inserting ring buffers into the time-dimension layers. This driver
supports **both** inference shapes, because the published pretrained weights
need both:

| Mode | Graph | Driver loop | Used by |
|---|---|---|---|
| `streaming-external-state` | stateless; every ring buffer is an explicit input/output | one packet (e.g. 20 ms) in → posterior + updated states out | streamable topologies (`dnn`…`bc_resnet`) |
| `sliding-window` | the non-streaming graph as-is | 1 s window, re-evaluated every `hopSamples` | attention topologies (`kws_transformer`, `att_mh_rnn`) — what ARM publishes |

Both are a thin loop over onnxruntime-web, so there is **no new runtime
dependency** (the repo already vendors it for the openwakeword/plix drivers).

> **Why sliding-window exists.** The first implementation covered only the
> external-state path. The available pretrained checkpoints
> (ARM-software/keyword-transformer) are all *non-streamable* topologies that
> ship **only** `tflite_non_stream/`, so none of them could have loaded. Upstream
> cannot convert attention-over-the-whole-sequence models to streaming, so the
> window has to slide on our side.

The module covers every published model family with one code path (`dnn`,
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
    single-wake-word detector. This is the reference driver for ADR-039's
    "one model, many labels" contract — trained bundles carry a standard
    `labels.json` (upstream `labels.txt` normalized) so the console can test
    every wake word of the model (`docs/modules/training.md` §4.5).
  - The `spec.train` block wiring the **unpatched upstream**
    `kws_streaming/train/model_train_eval.py` (ADR-031) plus a
    `standardize-results` adapter for its run directory.
  - The module's spec-driven panel (ADR-017/024 dual-layer) and L1 tests.
- **Out of scope:**
  - The generic detection loop (VAD gate, smoothing, threshold, min-duration,
    cooldown) — owned by `kws-engine` (ADR-030).
  - The AFE (this module consumes `AFEOutputFrame`).
  - **Training a model ourselves.** `spec.train` wires the upstream script and a
    module-owned **train adapter** (`train/train_adapter.py`, #152) now runs it
    through the studio-backend (data prep + unmodified upstream invocation +
    standard-bundle normalization). Four **pretrained** models remain registered
    (§6.5) so the driver also works today without training.
  - Quantized (int8) exports and MCU deployment of these graphs (Phase 4/5).
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
  - **`google-research/kws_streaming`** (Apache-2.0) - the model definitions +
    training/conversion scripts. **Vendored pristine** at
    `third_party/kws_streaming` (ADR-037 Tier 3, import at `cf61877d`, #156):
    the upstream is archived, so WakeStudio owns compatibility through a
    maintained mini-fork on the pinned Keras-2 line (ADR-038 — TF
    2.15.1, numpy 1.26.4, protobuf 3.20.3, Python 3.11, proven to train);
    the two TF >= 2.16 compat patches are the fork's delta. The
    adapter invokes the upstream script itself unchanged (ADR-031) and its
    TF drift guard fails loudly if the runtime TF drifts from the declared
    line.
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
| model source | primary | `kws-streaming-kwt1` | §6.5 entries, or a custom URL | Picked in the Model-source editor. The registry entry carries `url` + `manifestUrl`, so a model can never be paired with another model's manifest. |
| `wantedWord` | primary | `yes` | the 10 real labels | Which label column is the wake word (`_silence_`/`_unknown_` excluded). |
| `threshold` | primary | 0.5 | 0-1 | Detection threshold on the selected posterior (engine-applied). |
| `resetOnTrigger` | advanced | false | - | false = upstream `reset0` (states kept, the paper's streaming setting); true = `reset1`. |
| `executionProvider` | advanced | `wasm` | `wasm` only | **WASM only, enforced by the driver.** onnxruntime-web's WebGPU (jsep) EP mis-executes this graph's CLS-token `Slice`→`Squeeze`: it ignores the `axes` input and fails at `run()` with `Dimension of input 2 must be 1 instead of 64. shape={1,1,64}` — even though squeezing axis 1 of `{1,1,64}` is valid, and the identical graph runs correctly on WASM. The driver forces WASM even when the engine asks for WebGPU, and reports `wasm` as its effective EP. These graphs are tiny, so WebGPU dispatch overhead would dominate anyway. |

### 6.2 Fixed constants

| Constant | Value | Notes |
|---|---|---|
| `sampleRate` | 16000 | Upstream default; the AFE already delivers 16 kHz. |
| AFE frame | 160 samples | 10 ms; buffered up to `manifest.packetSamples`. |
| `packetSamples` | from manifest | Streaming mode: typically 320 (20 ms); must match the graph's time stride. |
| `windowSamples` | from manifest | Sliding-window mode: 16000 (1 s) for the shipped models. |
| `hopSamples` | from manifest | Sliding-window mode: 1600 (100 ms) — detection latency vs CPU. |

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

The **module-owned train adapter** (`spec.train.entry =
train/train_adapter.py`, #152) prepares the data — `speech-commands-v2`
(CC BY 4.0), a `user-url` dataset archive, or multi-language `edge-tts`
synthesis (`docs/modules/data-sources.md`) — invokes
`python -m kws_streaming.train.model_train_eval` **unchanged**, and normalizes
the run dir into the standard artifact bundle (`docs/modules/training.md` §6).
The studio-backend registry (`apps/studio-backend/registry.json`) maps the job
params to `STREAM_*` env vars. The module declares `studio-backend` + `ci`
invocations; a Colab notebook for this module is deferred until one is
module-owned (no `.ipynb` exists yet).

### 6.4 Build inputs

`spec.build` declares the conversion the artifact needs, so the generic
`build.yaml` can run it once a trained checkpoint exists:

| Input | Default | Notes |
|---|---|---|
| `checkpoint_repo` | `ARM-software/keyword-transformer` | Repo publishing `kws_streaming`-family checkpoints. |
| `checkpoint_ref` | `master` | Pinned ref of that repo. |
| `checkpoint_root` | `models_data_v2_12_labels` | Directory holding the checkpoint dirs. |
| `checkpoints` | `kwt1,kwt2,kwt3,att_mh_rnn_1` | Which checkpoints to convert. |
| `opset` | `17` | ONNX opset for the TFLite→ONNX conversion. |
| `hop_ms` | `100` | Sliding-window re-evaluation period. |
| `validate` | `false` | Validate against real Speech Commands audio (~2.3 GB download). **Must be `true`** for any artifact we register. |
| `min_accuracy` | `0.8` | Build fails below this argmax accuracy. |
| `per_label` | `10` | Clips per label when validating. |

Build: `gh workflow run build.yaml -f module=kws-streaming -f inputs_json='{"validate":"true"}'`
→ fetch: `node scripts/fetch-artifact.mjs kws-streaming`.

### 6.5 Shipped pretrained models

Registered in `model-registry.json` (Apache-2.0, commercially clean — ARM
publishes them under the repo's Apache-2.0 license, and they are trained on
Speech Commands, CC-BY-4.0). All are 12-label Speech Commands V2 models
(`_silence_`, `_unknown_`, yes, no, up, down, left, right, on, off, stop, go)
in `sliding-window` mode:

| Registry id | Model | ONNX size | Upstream top-1 | CI re-validation |
|---|---|---|---|---|
| `kws-streaming-kwt1` | Keyword Transformer (1 head) | 3.5 MiB | 97.61% | 100.0% (120/120) |
| `kws-streaming-kwt2` | Keyword Transformer (wider) | 10.5 MiB | 98.24% | 100.0% (120/120) |
| `kws-streaming-kwt3` | Keyword Transformer (largest) | 21.8 MiB | 98.65% | 99.2% (119/120) |
| `kws-streaming-att-mh-rnn` | att_mh_rnn (CNN+biLSTM+MHA) | 5.7 MiB | 98.48% | 99.2% (119/120) |

"Upstream top-1" is each checkpoint's own `accuracy_last.txt`; "CI re-validation"
is our own measurement on real Speech Commands clips after conversion (§9), with
a silence check asserting `_silence_` wins on zeros.

> **`sha256` is `null` and `sizeBytes` is nominal, on purpose.** `tf2onnx` output
> is not byte-reproducible: the same kwt1 checkpoint produced 3 713 927 bytes
> locally, 3 713 945 and 3 713 930 in two CI runs. A recorded hash would fail the
> next rebuild, and an exact byte count would simply be wrong; `sizeBytes` is
> display-only ("3.5 MiB"), so it is stored rounded. Hash pinning requires making
> the build deterministic first.

## 7. Error model & failure modes

- **Artifact missing** (the ONNX files are gitignored, ADR-011): `load()`
  rejects; the fix is `node scripts/fetch-artifact.mjs kws-streaming`. The
  deploy workflow does this automatically (non-fatal, matching sherpa/plix).
- **Model without its manifest** (e.g. a custom URL whose sidecar is absent):
  `load()` rejects before creating the session. The driver never guesses
  geometry — a wrong window length or label order produces confident nonsense.
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
- **WebGPU requested:** silently downgraded to WASM (with a `console.warn`), not
  an error - see §6.1. The alternative was every `run()` throwing a `Squeeze`
  shape error while the engine reported `ready`.
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
- **L2 (Node, `tests/onnx-runtime.test.ts`):** boots the REAL exported artifact
  in onnxruntime-node and asserts (a) the manifest validates, (b) it matches the
  graph's actual tensor names, (c) a 1 s window yields 12 finite logits that
  softmax to 1, (d) silence does not fire a word, and (e) **frame-by-frame
  streaming equals whole-clip inference** — 100 × 160-sample AFE frames pushed
  through `SlidingWindow` must reproduce the direct-inference logits. That last
  one is the alignment guard: an off-by-one or dropped sample would still
  produce plausible scores, so "it runs" proves nothing. Skips (not fails) when
  the artifact is absent.
- **Build-time real-audio validation (`scripts/validate-kws-streaming.py`):**
  runs each export over real Speech Commands clips in CI, asserting argmax
  accuracy against the checkpoint's own label order plus a silence check.
  Structural conversion is not correctness — a graph can convert cleanly, pass a
  zeros-input smoke test, and still be numerically wrong (bad weight layout,
  dropped transform, permuted outputs). The build fails below `min_accuracy`.
- **L3 (Playwright, `apps/web/e2e/kws-streaming-inference.spec.ts`):** drives the
  REAL driver in a real browser and asserts it **infers** — a score actually
  comes out — and that it pins WASM even when WebGPU is requested.

  > **Why inference, not loading.** The first L3 spec only asserted the engine
  > reached `ready`. It passed while EVERY `run()` threw the jsep `Squeeze`
  > error, because "ready" only means a session was created. Node's L2 could not
  > catch it either: onnxruntime-**node** has no jsep EP, so the same graph ran
  > fine there. A load-only browser test plus a Node inference test leaves
  > exactly this hole. The spec runs against a bundled harness page
  > (`apps/web/e2e-fixtures/`, built only with `E2E_HARNESS=1`) so it exercises
  > the shipped driver rather than a re-implementation, and it was verified to
  > FAIL when the WASM pin is reverted.

  `apps/web/e2e/kws-streaming.spec.ts` still covers the UI path (backend
  selectable, models listed, dropdown labels non-empty).
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

- **[Q-KS-1] Which model is the default?** *Partly answered:* the shipped
  default is `kws-streaming-kwt1` (3.7 MB, 97.61%) — the smallest pretrained
  option, so first load is fast. The train adapter (#152) now closes the
  *capability* gap for training a streamable topology (e.g. `bc_resnet` for the
  MCU tier, the only way to get an external-state streaming model); actually
  producing + registering that model is still pending.
- **[Q-KS-2] Do we support `preprocess: 'mfcc'`/`'micro'` exports?** These put
  the feature extractor *outside* the graph, so the driver would need an
  `@wake-studio/dsp` MFCC front-end bit-matched to upstream's TFLite ops. It
  matters for MCU parity (the `micro` path is the TFLite-Micro one), but for the
  browser `preprocess: 'raw'` is strictly simpler. Proposal: reject for now,
  revisit with the device SDK.
- **[Q-KS-3] TFLite→ONNX, or a TFLite runtime?** **Answered: convert.** `tf2onnx`
  handled all four checkpoints with no op-coverage gaps and the converted graphs
  re-validate at 99.2-100% on real audio, so we keep ONE inference stack
  (onnxruntime-web) and do not add `@tensorflow/tfjs`. Caveat recorded in §6.5:
  conversion is not byte-reproducible.
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
| 2026-08-10 | Add `sliding-window` mode (the published ARM checkpoints are non-streamable and ship only `tflite_non_stream/`, so external-state alone could load nothing). CI TFLite→ONNX export + real-audio validation; 4 pretrained models registered and working in the web console; L2 + L3 now real (were declared gaps). Q-KS-3 answered (convert to ONNX); Q-KS-1 partly answered. | agent |
| 2026-08-11 | Fix inference failing in the browser: pin the WASM EP (WebGPU/jsep mis-executes the CLS-token `Slice`→`Squeeze`); report the effective EP so the UI stops claiming WebGPU. L3 replaced with an INFERENCE spec after the load-only one passed while every `run()` threw. | agent |
| 2026-08-14 | **Train adapter shipped (#152):** `train/train_adapter.py` runs the unpatched upstream trainer through the studio-backend with pluggable data sources (Speech Commands V2 / user URL / edge-tts TTS / local dir) and normalizes into the standard bundle; registry entry + fake-upstream tests (no GPU/network). Q-KS-1 capability gap closed. | agent |
| 2026-08-17 | **Mixed data sources (#158):** `dataSource=mixed` merges TTS positives (`positiveSource`) with real-speech unknowns + noise (`negativeSource`, SC2 / user-url / none) via `merge_label_trees`; collision-safe merge, per-source provenance; 4 backend + 2 module tests. | agent |
