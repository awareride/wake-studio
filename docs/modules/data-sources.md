# Data Sources & Datasets (Audio Generation & Dataset Management) - Module Specification

- **Status:** Draft - design locked from human discussion (2026-08-20); implementation at Phase 5 start
- **Owner:** WakeStudio team
- **Plan phase:** Phase 5
- **Related ADRs:** ADR-022 (data-source layer), ADR-013 (training backends), ADR-023 (Colab
  backend), ADR-025 (spec-driven modules), ADR-028 (uv train scripts), ADR-031 (upstream-script
  adapters), ADR-033 (self-registering drivers), ADR-036 (job-manager API), ADR-039
  (labels/formats/convert), ADR-044 (datasets as first-class artifacts)
- **Depends on (modules):** Training (consumes datasets), Export (license provenance)
- **Last updated:** 2026-08-20 (#203 implemented)

## 1. Purpose

Training-data sourcing is a **pluggable data-source layer** with in-app endpoint configuration
(ADR-022). It provides the audio a wake-word model is trained on: **platform pre-built resources**
(public datasets, project-organized datasets) and **auto-generated spoken audio samples**. Audio
generation **does not run inside WASM**; it runs in the selected training backend (Self-hosted
Service, Cloud Provider, or Colab - ADR-013 amendment) or, for online HTTP TTS, directly in the
browser. This module is what makes "train a custom wake word from a phrase" possible without the
user hand-collecting audio.

**Phase 5 addition (this revision):** datasets are **first-class artifacts with a lifecycle of
their own** - create, persist, reuse, share - not a byproduct of a train job. The same dataset is
usable across **different training pipelines** via a portable spec + per-trainer materializers.

> This document was a stub until 2026-08-20. The dataset-as-artifact design below was locked in a
> human design discussion (2026-08-20) and is the spec home for the Phase 5 dataset work. It will
> also be recorded as a new ADR alongside the train integration contract (ADR-013/022/039).

## 2. The problem this solves

Today datasets are a byproduct of a train job: `prepare_data` synthesizes/downloads a
`label/*.wav` tree into the job's ephemeral workdir. Consequences:

- The generated data is **lost** when the job ends (and instantly on a Colab runtime drop).
- Every train **re-generates / re-downloads** the same data from scratch.
- Datasets cannot be **reused, versioned, or shared**.

Goal (2026-08-20 discussion): datasets are **first-class artifacts** - users pick one or more
existing datasets before starting a train, common datasets ship as built-ins, generated datasets
persist to the backend store and/or the user's cloud (Hugging Face / Cloudflare R2 / Google Drive),
and a portable **dataset spec** lets the same dataset feed different trainers.

## 3. Scope & boundaries

- **In scope:**
  - The **dataset spec**: `dataset.json` manifest + canonical `label/*.wav` tree + one importer.
  - **Dataset lifecycle**: generation jobs, persistence, cloud push/pull, built-in catalog,
    Datasets console.
  - The **generation pipeline** with pluggable TTS engines + postprocess transforms.
  - **Materializers**: canonical dataset -> per-trainer input shape (portability).
  - **Mixing datasets** (positives / unknowns / noise) with collision safety (existing
    `merge_label_trees`, #158).
  - Quality gate, dedup/split, reproducibility, provenance chain.
- **Out of scope:**
  - Model training itself (Training module / Phase 5 backends).
  - In-browser WASM generation (explicitly excluded by ADR-022).
  - The live AFE/KWS pipeline (AFE/KWS modules).
- **Public surface:** the dataset spec + importer, the generation-job contract, the
  engine/storage plugin descriptors, the Datasets console contract, and per-source
  license/provenance records.

## 4. Dataset as a first-class artifact - the spec

### 4.1 Canonical form

Every dataset, regardless of origin (builtin / generated / uploaded / public), is one
`wake-studio-dataset.zip`:

```
wake-studio-dataset.zip
├── dataset.json          <-- the portability contract
└── audio/
    ├── hey-studio/<clips>.wav     (16 kHz mono PCM WAV, canonical)
    ├── good-morning/<clips>.wav
    └── ...label folders...
```

Canonical audio is **16 kHz mono PCM WAV**. Other rates / encodings / precomputed features are
**derived** at materialize or push time - the same "canonical artifact + derived formats" rule as
ADR-039 for models.

**HF-compatible layout (ADR-045):** `audio/<label>/*.wav` already matches the Hugging Face
`AudioFolder` (folders-as-classes) convention, so the archive doubles as a valid HF dataset repo
with no re-layout. The zip also carries **derived** HF exports: `metadata.csv` (row features:
`file_name`, `label`, plus role/transcript/speaker/language/provenance) and `README.md`
(dataset-card YAML front-matter; `license`/`language` from provenance). Both are **generated from
`dataset.json`** — the manifest stays the single source of truth and the three never drift. A
dataset is stored either as this **zip** (portable/transport form) or as the same content as an
**unpacked directory** (the "live" form); the two are a pure archive/unzip apart. Pushing to HF =
uploading the directory; HF's own viewer then supplies playback/table for cloud-stored datasets.

**Implemented (#203, ADR-044):** the schema is `packages/modules/data/dataset/core/spec.ts`
(TypeScript, source of truth) with the Python mirror `apps/studio-backend/src/wake_train_kit/
dataset.py`; the web importer is `packages/modules/data/dataset/core/manifest.ts` (typed
`DatasetImportError` codes). The two importer/hash implementations are byte-identical for the
`contentHash` so a backend-produced dataset verifies in the browser and vice versa.

### 4.2 dataset.json manifest

```jsonc
{
  "id": "uuid",
  "name": "wake-words-zh-en",
  "version": 1,
  "kind": "builtin" | "generated" | "uploaded" | "public",
  "role": "positive" | "unknowns" | "noise" | "mixed",     // what the dataset is for
  "audio": { "sampleRate": 16000, "channels": 1, "encoding": "pcm_s16le",
             "clips": 210, "durationSec": 940 },
  "labels": [
    { "name": "hey studio",   "role": "positive" },        // -> wanted word
    { "name": "good morning", "role": "positive" },        // -> wanted word (multi-word)
    { "name": "_unknown",     "role": "unknown"  },        // -> folds into _unknown_
    { "name": "noise",        "role": "noise"    }         // -> _background_noise_ / augmentation
  ],
  "provenance": [ { "name": "...", "license": "...", "commercialUse": true, "source": "..." } ],
  "recipe": { "engine": "edge-tts", "phrases": [...], "languages": ["zh-CN", "en-US"],
              "seed": 0, "toolVersions": { "edge-tts": "..." } },
  "contentHash": "sha256:...",                              // change detection; any change bumps version
  "storage": { "backend": "datasets/<id>/",
               "cloud": "hf://user/ds | r2://bucket | gdrive://" }
}
```

**The portability rule:** the manifest declares each label's **semantic role**
(`positive` / `unknown` / `noise`); it never bakes trainer-specific folder magic
(`_background_noise_`, `_unknown_`) into the contract. Per-trainer materializers create the
folders the upstream trainer expects. **Roles are the portable vocabulary; folders are
per-trainer.**

### 4.3 Lifecycle

```
create (generate/import) -> validate -> persist (backend [+ optional cloud]) -> reuse in N trains -> share/upload -> (eventually) delete/GC
```

- Datasets live in the backend `datasets/` store (survives restarts), optionally also in the
  user's cloud (HF / R2 / GDrive) for durability and sharing.
- A trained model records the exact dataset refs + versions it consumed (provenance chain, SS10).

## 5. Generation as a first-class job

`prepare_data` is split out of the train adapter into a **`dataset-generate` job** - a new
registry entry on the existing job manager (ADR-036: subprocess-per-job, NDJSON reporting,
pause/resume/cancel, SSE, SQLite persistence). Generation is a short job on the same machinery.
One pipeline runs everywhere:

```
collect -> synthesize -> postprocess -> assemble -> persist
```

**Implemented (#205):** the backend pipeline is `wake_train_kit/generation.py` (one
`generate_dataset()` orchestrator: synthesize -> postprocess -> assemble -> persist, emitting
NDJSON progress) + `generation_runner.py` (the `dataset-generate` registry entry, ADR-036
subprocess). **Engines are MODULES, not descriptor files** (human decision 2026-08-20): each
`data`-category engine module (`packages/modules/data/{edge-tts,mimo-tts,piper,qwen-llm-tts}/`)
owns `spec/module.spec.json` (`spec.params` drives its generated panel, `spec.tts` declares
kind/runtime/provenanceTemplate — like KWS drivers) and `adapter.py` (the backend engine
adapter, loaded at runtime by `wake_train_kit.generation`). `edge-tts` (classic, reuses
`data_sources`), `mimo-tts` (online HTTP, OpenAI-compatible chat.completions via the shared
`wake_train_kit/http_tts.py`, mockable HTTP client), `qwen-llm-tts` (llm-tts, shares the HTTP
machinery); `piper` is declared but its adapter lands with the openwakeword path. Postprocess:
`wake_train_kit/postprocess.py` (passthrough + `openwakeword-style` pitch/rate/volume
perturbation via ffmpeg). The catalog `apps/web/public/dataset-engines.json` is generated from
the engine modules' `spec.tts` via `scripts/build-dataset-engines.mjs` (same discovery as
`spec.train` -> `train-modules.json`).

### 5.1 TTS engine plugins

The **TTS engine** is a pluggable capability (ADR-033 self-registration style), not a hard-coded
list. Three kinds:

| Kind | Examples | Runtime |
|---|---|---|
| `classic-tts` | edge-tts, piper | backend |
| `online-http-tts` | any user-configured online TTS API (e.g. mimo.mi.com speech synthesis v2.5) - user enters endpoint + API key | browser + backend |
| `llm-tts` | qwen (e.g. Qwen2.5-Omni), vibe-voice, F5-TTS | backend (GPU) |

An engine is a **module** (`packages/modules/data/<id>/`) — its `spec.params` drive a
generated panel (ADR-025) and its `spec.tts` declares the engine metadata, e.g. for mimo-tts:

```jsonc
// packages/modules/data/mimo-tts/spec/module.spec.json (excerpt)
{
  "meta": { "id": "mimo-tts", "category": "data", "name": "MiMo TTS (online HTTP)" },
  "params": [ // standard ModuleParam[] - renders the engine's own generation form
    { "id": "endpoint", "type": "string",  "default": "https://api.xiaomimimo.com/v1" },
    { "id": "apiKey",   "type": "secret" },
    { "id": "model",    "type": "string",  "default": "mimo-v2.5-tts" }
  ],
  "tts": { "kind": "online-http-tts", "runtime": ["browser", "backend"],
           "provenanceTemplate": { "name": "MiMo TTS (online API) synthetic speech",
                                    "license": "user-owned (synthetic TTS)",
                                    "commercialUse": true } }
}
```

An `online-http-tts` engine (mimo-style) can run **in the browser** (pure fetch + fflate zip, no
backend) or in the backend; the pipeline is one code path, only the executor differs.

### 5.2 Postprocess transforms

Postprocessing (e.g. openwakeword-style augmentation/perturbation) is a **third pluggable type**,
composable after any engine - not a vendor. Transforms: augment/perturb, normalize loudness,
resample, trim / silence handling.

### 5.3 Storage plugins

Persistence is a **StorageBackend plugin** behind one interface (`push` / `pull` / `list` /
`delete`): `backend-disk` (default), `huggingface` (dataset repo), `cloudflare-r2`
(S3-compatible), `google-drive`, `url` (built-in / public, read-only). Descriptor declares its
auth key. A dataset may be stored as a **zip** (the portable/transport artifact) or as an
**unpacked directory** in the HF layout (ADR-045); cloud push can send the directory (listenable)
and/or the zip (portable/backup).

```jsonc
{ "id": "r2", "kind": "s3-compatible", "authKey": "cloud.r2",
  "capabilities": ["push", "pull", "list", "delete"], "format": "zip" }
```

**Implemented (#204):** `StorageBackend` interface + registry in
`apps/studio-backend/src/wake_train_kit/storage.py` (ADR-033 self-registration; the TS
catalog/types live in `packages/modules/data/dataset/core/storage.ts`). `backend-disk` and
`url` (read-only pull) are fully implemented; `hf` / `r2` / `gdrive` are registered with
their descriptors + authKey and raise a clear "requires <sdk>" error until real SDK wiring
(issue #107 / push-job console #208). A `dataset-storage` job entry runs push/pull/list/
delete on the job manager; tests use FAKE adapters (no real cloud).

**Credentials** live in Settings (new "Cloud storage" group), client-side, masked, never logged
or exported - the same guarantees as the existing `backend.apiKey` / `backend.secret`.
**ADR-013 tension (open, Q-DS-3):** a *backend* job pushing to cloud needs the key server-side.
Precedent exists (Colab notebook keys already flow as job params/env, ADR-013/023); recommended
default: key passed as a **job-scoped env var only**, never persisted.

### 5.4 Extensibility model - split by concern, not by vendor

One host `dataset` module + engine / storage / postprocess plugin axes. A full module owns
core + spec + generated panel + tests + playground + multi-target deliverables (ADR-025); TTS /
storage vendors do not need a playground each, and their panels are the same
"endpoint + key + voice" form. Plugins **self-register** via descriptors; a build script
generates the catalog (like `train-modules.json` from `scripts/build-model-registry.mjs`).
**Adding a vendor = drop in a package + descriptor, no host-module edits.**

```
packages/modules/dataset/            <- ONE host module (new `dataset` category)
  core/
    spec.ts            dataset.json manifest schema + validation
    generation.ts      pipeline: collect -> synthesize -> postprocess -> assemble -> persist
    materialize.ts     canonical -> per-trainer shape (SS6)
  engines/             <- plugin type #1 (TTS / synthesis)
    edge-tts/  piper/  mimo/  qwen/  vibe-voice/  f5-tts/
  storage/             <- plugin type #2 (cloud / local persistence)
    backend-disk/  huggingface/  cloudflare-r2/  google-drive/  url/
  postprocess/         <- plugin type #3 (transforms, e.g. openwakeword-style augment)
```

Backend-runnable engines/storages become entries in the existing studio-backend `registry.json`
(subprocess per generation job, ADR-036); browser-capable ones (online HTTP) run client-side with
the same pipeline code.

## 6. Materializers - making the spec usable by different trainings

Different trainers consume data differently (kws-streaming: raw `label/*.wav` tree;
openwakeword: precomputed mel features + a positives wav dir + background dirs). One
canonical spec + **per-trainer materializer** (the data-side twin of `standardize-results`,
ADR-031):

| Trainer | Requires (`spec.train.dataset`) | Materializer does |
|---|---|---|
| kws-streaming | label tree, 16k, multi-label, needs noise | near-identity: role -> folder map, write `_background_noise_` from `role: noise` |
| openwakeword | positives wav dir + features + background | run its feature extractor on positive clips -> `.npy`; negatives -> precomputed features; noise -> `background_paths` |
| future trainers | whatever | its own materializer |

**Implemented (#206):**

- `spec.train.dataset` declares requirements (`sampleRate`, `minClipsPerLabel`,
  `needsNoise`, `needsUnknowns`, `labelMode` `single`/`multi`/`class`) — a new field on
  `ModuleTrain` in `packages/contracts` (+ the module-spec JSON schema). The wizard and the
  adapters share it, so there is ONE source of truth for what a trainer needs.
- `packages/modules/data/dataset/core/materialize.ts` is the **TypeScript source of truth**: the
  per-trainer role -> folder maps (`KWS_STREAMING_MATERIALIZER` / `OPENWAKEWORD_MATERIALIZER`),
  `validateDatasetRequirements` (the pre-train validation the wizard picker runs) and
  `planKwsStreamingLayout`.
- `wake_train_kit/materialize.py` is the **backend executor** the train adapters run:
  `materialize_kws_streaming` (extract each dataset -> per-dataset role->folder tree -> merge
  across datasets with the #158 collision rules; real `_background_noise_` wins) and
  `materialize_openwakeword` (positives wav dir + precomputed mel `.npy` via an injectable
  feature extractor, defaulting to openWakeWord's own; noise -> `background_paths`). Both
  validate first and surface clear pre-train errors/warnings instead of a cryptic trainer crash.
- The **training wizard** replaces the `dataSource` selector with a `datasets[]` picker
  (one or more existing datasets) fed from the backend `datasets/` store (`GET /datasets`, #204)
  and validates the pick against `spec.train.dataset` (`DatasetPicker`, issue #206).
- Train adapters' `prepare_data` becomes **load refs from the store -> materialize -> merge**
  (`STREAM_DATASETS` / `WAKE_DATASETS`); upstream trainer scripts stay byte-identical (ADR-031).

## 7. Built-in dataset catalog

Spec-driven `datasets.json` (like `train-modules.json`), focused on multi-language + noise
coverage. v1 candidates (license + `commercialUse` flagged; Q-DS-4 to confirm the exact list):

- **Speech Commands V2** (CC BY 4.0) - already integrated; the one built-in that is fully
  materializable today (`materialize.type: speech-commands-v2` via the ADR-022 converter).
- **Common Voice** (multi-language, CC0).
- **Google Speech Commands** (CC BY 4.0).
- **AudioSet / FMA** noise clips + openwakeword features (research-use - flagged so the export
  gate stays honest).

Built-ins are immutable references (`kind: builtin`), materialized on first use.

**Implemented (#207):**

- Curated source of truth: `packages/modules/data/dataset/catalog/builtins.json` (a
  `DatasetBuiltinCatalog` — every entry is a full `DatasetManifest` + a `materialize`
  descriptor). The web bundle `apps/web/public/datasets.json` is generated from it by
  `scripts/build-dataset-catalog.mjs` (`pnpm gen:catalog` / `gen:catalog:check`, the same
  update/check pattern as `train-modules.json` / `dataset-engines.json`); CI fails when stale.
- Catalog types + validation in `core/catalog.ts` (`validateDatasetCatalog`, `BuiltinMaterialize`
  = `canonical-zip` | `speech-commands-v2` | `pending-host`, `isBuiltinAvailable`).
- Backend `wake_train_kit/builtin_catalog.py`: `ensure_builtin` materializes a built-in into the
  `datasets/` store on first use — SC2 via the ADR-022 converter (packed to a canonical zip,
  contentHash-verified), `canonical-zip` by fetch+import, `pending-host` raises a clear
  "declared but not yet hosted" error. `materialize.extract_dataset` resolves built-in ids so a
  picked built-in works in training (load-refs → materialize → merge, #206). The catalog is
  wheel-packaged (`pyproject` force-include) for deployed/generic runtimes.
- The Training wizard `datasets[]` picker lists built-ins (from the static catalog) alongside
  store datasets; `pending-host` entries are shown disabled; `commercialUse: false` entries are
  flagged "non-commercial".

## 8. Datasets console (web)

A top-level **`Datasets`** menu item (between Training and Backends) mirroring the Training
console layout (`apps/web/src/datasets/console/`, implemented by #208):

- **Left rail:** dataset list (name, kind badge `builtin` / `generated` / `uploaded` / `cloud`,
  clip count, license) — one merged view over the built-in catalog (`datasets.json`), the
  backend `datasets/` store (`GET /datasets`), and the browser-local store (IndexedDB, for
  datasets generated/imported client-side).
- **Details pane:** manifest (labels, counts, provenance, storage), quality report (render what
  the manifest carries today; the health-check job is #209), actions: **New generation task**,
  **Train with this**, **Upload to cloud**, **Download**, **Delete**.
- **New** = generation wizard (engine -> phrases/languages/voices -> postprocess -> save
  destination); generation jobs are tracked in the rail (same job UI as Training).

The Training wizard's dataset-picker step is fed by this same Datasets store (SS6) — built-ins
+ backend store + browser-local store merge into one `datasets[]` picker.

### 8.1 Executor decision (one pipeline, two executors — locked, human, #208)

Generation + cloud upload are ONE pipeline (collect -> synthesize -> postprocess -> assemble ->
persist) with TWO executors, the same pattern as `spec.tts.runtime`. The console picks the
executor from **(a) the engine's declared `runtime`** in `dataset-engines.json` and **(b)
whether a studio-backend is connected** (a managed backend in the Backends menu with a base URL):

| Engine `runtime` | Studio-backend connected? | Executor | Cloud save |
|---|---|---|---|
| `browser` + `backend` (e.g. `mimo-tts`) | yes | **backend** (default — full-featured: persists to the store, enables every action) | `dataset-storage` job, creds as job-scoped env (Q-DS-3) |
| `browser` + `backend` | no | **browser** (client-side fetch TTS -> Web Audio -> canonical zip) | **direct browser push** via the storage catalog: `hf` feasible today (fetch + token); `r2` / `gdrive` flagged not-wired-browser-side (same treatment as #107 for backend SDKs) |
| `backend` only (`edge-tts`, `piper`, `qwen-llm-tts`) | no | — engine disabled in the wizard with a clear "needs a studio-backend" message | — |
| `backend` only | yes | **backend** | `dataset-storage` job |

**Browser executor** (`apps/web/src/datasets/browser/`): fetches the TTS endpoint
(OpenAI-compatible chat.completions — the TS twin of `wake_train_kit/http_tts.py`), decodes +
resamples to the canonical 16 kHz mono PCM WAV via Web Audio (no ffmpeg needed — a browser
advantage over the backend), assembles `dataset.json` + `audio/<label>/*.wav`, computes
`contentHash`, and zips with `fflate` (`core/generate.ts` keeps the pure, L1-testable helpers).
The produced zip is saved to the browser-local store and/or pushed straight to the user's cloud
(Hugging Face via `fetch` + the Settings `cloud.hf.token`). Credentials stay client-side, masked,
never persisted.

**Backend executor** (`dataset-generate` job): the same wizard submits `POST /jobs` with
`moduleId: dataset-generate` and the engine/params from the wizard; the backend runs
`wake_train_kit.generation`, persists to the `datasets/` store, and reports NDJSON progress that
the console renders with the reused Training job UI. "Upload to cloud" on a store dataset runs a
`dataset-storage` job (push) with the cloud creds passed as job-scoped secrets only.

### 8.2 Console + store surface

- `apps/web/src/datasets/store.ts` — the consolidated store (built-ins + backend `GET /datasets`
  + browser-local IndexedDB), used by BOTH the console and the Training `datasets[]` picker
  (SS6), so a browser-generated dataset appears in the train wizard without a backend.
- Browser-local store: `apps/web/src/datasets/local-store.ts` (IndexedDB) — stores **metadata
  only** (manifest + a handle/ref to the bytes), **never file bytes**; the working bytes live in
  **OPFS** (Origin Private File System) as imported (zip or directory, no eager unpack) and/or
  the cloud (ADR-045). Delete/refresh are local.
- Backend store actions the console drives (`apps/studio-backend`): `GET /datasets/{id}/download`
  (the stored canonical zip) and `DELETE /datasets/{id}` (remove from the store) — added with
  #208's actions.

### 8.3 Review & listen (ADR-045)

The details pane renders the manifest itself (audio summary, labels + roles, provenance,
storage); a **per-clip audio player** is shown only where reading a single clip is cheap
(**listenable**):

| Form | Location | Listen? |
|---|---|---|
| directory | local OPFS | ✓ (open one file) |
| directory | cloud (HF files) | ✓ (fetch one wav) |
| zip | local OPFS | ✓ (extract one entry via central dir + fflate — no full unpack) |
| zip | remote single blob | ✗ (no cheap random access) |

Playback reads a single clip on demand and never requires unpacking the whole dataset. Full
per-trainer materialization (unpack) runs only at train-prep time (§6).

## 9. Quality & reproducibility (v1 priorities)

1. **Quality gate** - a `check-dataset` job produces a health report: clip counts per label,
   duration distribution, silence/empty clips, exact duplicates, clipping/distortion, sample-rate
   drift, label imbalance. Trainers refuse (or warn loudly) when a required label is empty.
2. **Synthetic-to-real gap** - record distinct voice count per label and `source:
   real | synthetic` per clip; warn on too-few voices or a 100% synthetic wake-word dataset (TTS
   overfit risk at inference).
3. **Dedup + reproducible splits** - exact/near-duplicate detection (perceptual hash) when mixing
   datasets (no train/eval leakage); a "split dataset" op records a fixed train/val/test
   partition in the manifest so every backend trains on the same split.
4. **Reproducibility** - `recipe.seed`, tool versions, and `contentHash`; "regenerate" is
   byte-reproducible; any silent change bumps `version`.

## 10. Provenance chain to the export gate

Dataset `commercialUse` flags **inherit** into any model trained on the dataset: training
metadata records the dataset refs + license flags, and `provenance.json` in the trained bundle
carries the inherited restriction so the Phase 4 export gate is honest without manual review.

## 11. Public API & types (existing training-time layer)

The layer is implemented in `apps/studio-backend/src/wake_train_kit/data_sources.py`
(training-time only; never imported by the browser). It exposes the **generation / mixing
primitives** used by dataset-generation jobs and materializers:

- `prepare_speech_commands_v2(data_dir, reporter) -> (root, provenance)` -
  download + extract Speech Commands V2 (CC BY 4.0).
- `prepare_user_archive(url, data_dir, reporter) -> (root, provenance)` -
  download + extract a user-provided `.tar.gz`/`.tgz`/`.tar`/`.zip` archive.
- `build_edge_tts_kws_dataset(phrases, languages, out_dir, ...) -> provenance` -
  multi-language wake-word positives + "unknown" negatives + `_background_noise_` silence clips,
  arranged as a `label/*.wav` tree.
- `merge_label_trees(positive_root, negative_root, out_dir) -> Path` -
  merge a positive tree with a negative tree into one data root. Positive labels are
  authoritative: a folder present in both trees is a **collision** and raises `DataSourceError`
  (never silently mixed). Real noise wins over synthesized silence; with `negative_root=None` the
  positive tree's silence is kept.
- Lower-level helpers: `download_file`, `extract_archive`, `find_data_root`, `synthesize`,
  `mp3_to_wav`, `write_silence_wav`.

Each source returns a **provenance** dict (name/license/source/commercialUse) recorded into the
bundle's `provenance.json` - the Phase 4 license-gate input.

## 12. Error model & failure modes

- `DataSourceError` on an unsupported archive type, a missing `dataUrl`, a missing `edge-tts`
  install, or a missing `ffmpeg` (edge-tts emits mp3; ffmpeg converts to 16 kHz WAV).
- `find_data_root` raises when no `label/*.wav` tree is found after extraction.
- Network downloads stream with heartbeats; a failure surfaces as an `error` NDJSON event from
  the adapter (the job is marked `failed`).
- New: materializer validation errors (dataset does not satisfy `spec.train.dataset`) surface as
  clear pre-train warnings, not trainer crashes; cloud push failures are surfaced per-storage
  plugin without corrupting the local dataset.

## 13. Observability

_To be specified._ Generation progress, per-source counts, per-label clip counts, and
license/provenance log shown in-app before export. The Datasets console shows the quality report
(SS9) and per-job NDJSON progress for generation jobs.

## 14. Security & privacy

- Endpoint/cloud credentials (if any) are held client-side only, never logged or exported
  (ADR-013 security note); cloud keys live in Settings, masked.
- Generated audio provenance is recorded so the export license gate (Phase 4) can verify
  commercial usability (SS10).

## 15. Open questions [Q]

| ID | Question | Recommended default |
|---|---|---|
| Q-DS-1 | Canonical default public-TTS endpoint(s) to ship pre-configured | **Answered (2026-08-14):** edge-tts is the default multi-language TTS path (studio-backend `tts` extra); Speech Commands V2 (CC BY 4.0) is the default corpus. Piper remains an option for the openwakeword path. |
| Q-DS-2 | Whether project server APIs are WakeStudio-hosted or community/self-hosted | Resolved at Phase 5 start. |
| Q-DS-3 | Cloud keys for backend-originated push jobs (ADR-013 tension) | **Implemented (#204):** job-scoped env var only, never persisted — the job manager accepts a `secrets` map passed to the subprocess env but excluded from the persisted job record (precedent: Colab notebook keys). |
| Q-DS-4 | Exact v1 built-in dataset catalog list | SC2 + Common Voice + Google Speech Commands + AudioSet/FMA noise (SS7). |
| Q-DS-5 | Near-duplicate detection threshold for the leakage guard | Tune at implementation; start with exact-hash + conservative perceptual hash. |

## 16. References

- ADR-022 (this layer), ADR-013 (training backends), ADR-023 (Colab), ADR-025 (spec-driven
  modules), ADR-028 (uv train scripts), ADR-031 (upstream-script adapters), ADR-033
  (self-registering drivers), ADR-036 (job-manager API), ADR-039 (labels/formats/convert).
- `docs/modules/training.md` (Phase 5 - datasets[] consumption), `LICENSES.md`
  (Piper/data licenses).
- Plan Phase 5, SS5.1.

## 17. Change log

| Date | Change | Author |
|---|---|---|
| 2026-07-27 | Initial stub (ADR-022 recorded; full contract deferred to Phase 5 start). | WakeStudio team |
| 2026-08-14 | **Data-source layer shipped (#152):** `wake_train_kit/data_sources.py` with Speech Commands V2 download (CC BY 4.0), user-URL archives, and multi-language edge-tts synthesis; provenance records per source; deterministic backend tests. Q-DS-1 answered. | agent |
| 2026-08-17 | **Mixed mode (#158):** `merge_label_trees` merges a positive tree (wake word) with a negative tree (real unknowns + real noise); collisions raise; real noise wins over synthesized silence. `dataSource=mixed` in the kws-streaming adapter + spec params + registry wiring; 4 new backend tests. | agent |
| 2026-08-20 | **Datasets as first-class artifacts (design locked, human discussion):** full spec written - `dataset.json` manifest + canonical `label/*.wav` tree + one importer (SS4); `dataset-generate` jobs with pluggable TTS engine / storage / postprocess plugins, split by concern not vendor (SS5); per-trainer materializers + `spec.train.dataset` compatibility (SS6); built-in catalog (SS7); Datasets console (SS8); quality gate / dedup+split / reproducibility (SS9); provenance chain to the export gate (SS10). Decision points resolved: composable granularity, cloud storage optional (HF / R2 / GDrive with user keys), user-configurable online TTS API+key, new-dataset-equals-new-version, multi-language+noise built-ins. Open: Q-DS-3/4/5. | agent |
| 2026-08-20 | **#203 — dataset spec implemented (ADR-044):** `packages/modules/data/dataset/` module (`core/spec.ts` manifest schema + validation, `core/hash.ts` canonical contentHash, `core/manifest.ts` single importer with typed `DatasetImportError` codes) + Python mirror `wake_train_kit/dataset.py` (byte-identical hash, verified cross-implementation); vitest + pytest suites; `.gitignore` `data/` anchored to `/data/` so the `data` category module is tracked. Remaining #204-#210 unchanged. | agent |
| 2026-08-20 | **#205 — dataset generation jobs (ADR-044 §5, human refactor 2026-08-20):** engines are MODULES (`packages/modules/data/{edge-tts,mimo-tts,piper,qwen-llm-tts}/`), each owning `spec/module.spec.json` (`params` -> generated panel, `tts` block = kind/runtime/provenanceTemplate) + `adapter.py` (module-owned backend adapter, loaded at runtime). Contracts gain `ModuleSpec.tts`. Backend pipeline `wake_train_kit/generation.py` (dispatcher + shared postprocess/assemble) + `generation_runner.py` (`dataset-generate` registry entry, NDJSON, canonical zip artifact); shared online/LLM HTTP machinery in `wake_train_kit/http_tts.py`; postprocess transforms (`passthrough` + `openwakeword-style`); catalog `apps/web/public/dataset-engines.json` generated from `spec.tts` via `scripts/build-dataset-engines.mjs` (like `spec.train`); tests (13 backend + dataset). Browser executor + generation wizard land in #208. | agent |
| 2026-08-20 | **#204 — dataset storage layer (ADR-044 §5.3):** backend `datasets/` store (`wake_train_kit/dataset_store.py`, SQLite index + `datasets/<id>/wake-studio-dataset.zip`, survives restarts, mirrors artifacts store; `dataset-generate` zips auto-persist into it). `StorageBackend` interface + registry + adapters (`backend-disk`/`url` real, `hf`/`r2`/`gdrive` declared with authKey) in `wake_train_kit/storage.py`; `dataset-storage` job entry (`storage_runner.py`). Web Settings gains a masked **Cloud storage** group; storage plugin catalog in `core/storage.ts` (authKey per plugin). Q-DS-3 implemented: cloud keys flow as job-scoped env only, never persisted. Tests: store round-trip, plugin registry, fake adapters (no real cloud). Remaining #206-#210 unchanged. | agent |
| 2026-08-20 | **#206 — materializers + `datasets[]` train consumption (ADR-044 §6):** `spec.train.dataset` requirements schema (contracts + JSON schema); `core/materialize.ts` (role->folder maps + `validateDatasetRequirements` picker validation); `wake_train_kit/materialize.py` (kws-streaming label-tree + openwakeword positives/features/background executors, #158 collision-safe merge); `GET /datasets` store API; wizard `datasets[]` picker replacing `dataSource`; adapters' `prepare_data` = load-refs → materialize → merge (`STREAM_DATASETS`/`WAKE_DATASETS`), upstream scripts byte-identical. Tests: 17 backend materialize + 4 adapter e2e (fake upstream + fake feature extractor) + TS validation suite. Remaining #207-#210 unchanged. | agent |
| 2026-08-20 | **#207 — built-in dataset catalog (ADR-044 §7):** curated `catalog/builtins.json` (SC2 / Google Speech Commands / Common Voice / AudioSet+FMA noise, each with license + `commercialUse`); `scripts/build-dataset-catalog.mjs` → `apps/web/public/datasets.json` (`pnpm gen:catalog[:check]`, CI check); types + `validateDatasetCatalog` in `core/catalog.ts` (`canonical-zip`/`speech-commands-v2`/`pending-host` materialize); backend `wake_train_kit/builtin_catalog.py` materialize-on-first-use (SC2 via the ADR-022 converter; wheel-packaged); wizard picker lists built-ins (pending-host disabled, non-commercial flagged). Tests: 8 backend (fake SC2 source, no network) + 9 TS catalog. Remaining #208-#210 unchanged. | agent |
| 2026-08-20 | **#208 — Datasets console (web, ADR-044 §8):** top-level `Datasets` nav + `#/datasets` route; list-detail console (rail = built-ins + backend store + browser-local store; details = manifest/provenance/storage/quality-report); generation wizard with the **two-executor decision locked** (§8.1 — engine `runtime` + studio-backend connectivity picks browser vs backend executor); browser executor (fetch TTS → Web Audio → canonical zip → HF direct push) + backend executor (`dataset-generate` job with reused Training NDJSON job UI); actions New/Train-with/Upload/Download/Delete (`GET/DELETE /datasets/{id}` backend routes); Training `datasets[]` picker fed from the same consolidated store. Follow-up fix: `pyproject.toml` force-include path for `builtins.json` was relative to `apps/studio-backend` (broke the wheel build) — corrected to `../../packages/...`. | agent |
| 2026-08-20 | **Storage & on-disk form (ADR-045, human discussion):** canonical form made HF-recognized — contents ARE the HF `AudioFolder` layout + **derived** `metadata.csv` / `README.md` exported from `dataset.json` (single source of truth, never drift). Two storage forms: **zip** (portable) and **unpacked directory** (live), a pure archive/unzip apart. **IndexedDB metadata-only** (no file bytes); browser-local bytes move to **OPFS**. **No eager auto-unpack on import** (large-dataset size concern); materialize stays deferred to train-prep. **Listenability = per-clip random access** (local dir / cloud dir / local zip via single-entry extract ✓; remote single zip blob ✗); console gains a gated per-clip player (spec §8.3). | agent |
| 2026-08-25 | **#210 — provenance chain to the export gate:** dataset `commercialUse` flags **inherit** into trained bundles. `materialize.inherited_provenance` computes the bundle `provenance.json` (license flips `user-owned` → `research-only`, `commercialUse=false`, `restrictedBy` lists the restricting datasets); `materialize.dataset_refs_from_manifests` records per-dataset id/name/version + license flags in `metadata.datasetRefs` (both kws-streaming + openwakeword adapters, lazy materialize import on legacy paths). Web: bundle importer parses `commercialUse`/`restrictedBy` + `isCommerciallyExportable` (the Phase 4 export-gate input); colab-import surfaces the inherited restriction in-app. Tests: 5 backend inheritance + 4 adapter e2e (research-only dataset) + 5 TS. | agent |
