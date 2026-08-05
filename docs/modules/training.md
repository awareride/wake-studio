# Training Module - Integration Contract (docs-first, §6.5 Step A)

- **Status:** Draft (awaiting human review - the train integration contract)
- **Owner:** WakeStudio team
- **Plan phase:** module-migration §6.5 (goal.plan Phase 5)
- **Related ADRs:** ADR-005 (self-hosted service), ADR-013 (training backends:
  Self-hosted / Cloud Providers / Colab), ADR-022 (data-source layer),
  ADR-023 (Colab backend), ADR-028 (uv train scripts)
- **Depends on (modules):** kws drivers (models to train), data-sources,
  export (provenance/license)
- **Last updated:** 2026-08-05

## 1. Purpose

Define the **training integration contract** before any code: how the PWA
submits a training job to each backend (Self-hosted Service, Cloud Providers,
Google Colab), how status is polled, and how the trained artifacts are
retrieved. This contract is locked **before** the training module's spec +
panel are built (§6.5 Step B). Backend implementations land in goal.plan
Phase 5.

> **Design principle (human, 2026-08-05): preserve upstream train scripts /
> notebooks as-is; adapt THEM to WakeStudio's API, not the other way round.**
> Upstream training artifacts (a project's `train.py`, a Colab `.ipynb`) are
> third-party works we select, integrate, and package - we do not rewrite or
> fork them (matches the project's "select, integrate, harden, and package"
> principle). WakeStudio adapts to whatever a script/notebook already is: a
> thin **adapter layer** declares how to invoke it and how to normalize its
> outputs into the standard bundle, without imposing a required script/notebook
> shape.

## 2. The common training-job interface (ADR-013)

All three backends share one shape, so the PWA flow is identical regardless of
backend:

```ts
interface TrainingJob {
  id: string                    // client-generated, uuid
  moduleId: string              // the module whose train/ script runs, e.g. 'kws-sherpa'
  params: Record<string, string> // backend-agnostic job params (from the panel)
  backend: 'self-hosted' | 'cloud' | 'colab'
  provider?: string             // cloud: 'aws' | 'gcp' | 'hf' | 'alibaba' | 'tencent' | 'volcengine'
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled'
  progress?: number             // 0..1
  artifactBundle?: ArtifactBundleRef
  error?: string
  createdAtMs: number
  updatedAtMs: number
}

interface ArtifactBundleRef {
  // One shared bundle manifest is the single retrieval contract (§4).
  manifestUrl: string   // local-service artifact URL / cloud presigned URL / colab download
  sha256?: string
}
```

### 2.1 Backend capabilities

| Backend | submit | poll | retrieve | Credentials |
|---|---|---|---|---|
| Self-hosted (local-service) | `POST /modules/:id/train` | `GET /modules/:id/status` | `GET /modules/:id/artifacts/<name>` | none (localhost trust) |
| Cloud Provider | provider API (submit job) | provider API (status) | presigned/download URL | client-side only (ADR-013) |
| Colab | open notebook (ADR-023) | user-driven (no polling) | import bundle from Drive/zip | user's Google account |

## 3. Self-hosted Service - local-service API (ADR-005)

The PWA talks to `apps/local-service` on `localhost`. The skeleton server
already exposes the train routes; this contract pins the shapes the PWA
consumes:

```
GET  /health
GET  /modules                          -> catalog (spec + targets)
GET  /modules/:id                      -> module spec + capabilities
POST /modules/:id/train                -> run train script (uv, ADR-028)
GET  /modules/:id/status               -> last train result
GET  /modules/:id/artifacts/<name>     -> download a trained artifact
```

**Auth:** localhost trust only (no tokens; binds 127.0.0.1 by default). If the
service is deployed on Google Cloud (ADR-005), the PWA connects to the user's
own endpoint - auth is a per-deployment concern (Phase 5).

**POST /modules/:id/train** body:

```jsonc
{
  "params": { "wakePhrase": "hey studio", "target": "mc", "epochs": "10" }
  // backend-agnostic; forwarded to the module's train script as args
}
```

**Response** (synchronous today; Phase 5 may make it async with a job id):

```jsonc
{ "module": "kws-sherpa", "exitCode": 0, "outputs": { "checkpoint": "/abs/path/out/model.onnx" } }
```

**Status** is currently synchronous (the skeleton blocks on `runTrain`); Phase 5
adds job queueing + streaming progress so the PWA shows live status.

## 4. Upstream-script adapters - we adapt to the script, not vice versa (human decision)

**We never rewrite an upstream `train.py` / `.ipynb`.** Instead, every module's
`spec/train` block gains an **adapter contract** that declares HOW to invoke
the upstream artifact and HOW to normalize its output. The upstream script
stays byte-identical; WakeStudio wraps it.

### 4.1 `spec/train` adapter fields (extended ModuleTrain)

```jsonc
// spec/module.spec.json
"train": {
  // HOW to invoke the upstream artifact (exactly one of the following):
  "entry": "train/train.py",            // (existing) local uv script (ADR-028)
  "script": {                            // NEW: an upstream repo script we do NOT own
    "repo": "https://github.com/dscripka/openWakeWord.git",  // pinned ref
    "path": "train.py",                  // relative path in that repo
    "ref": "<commit|tag>",
    "language": "python",                // python | node | shell
    "entrypoint": "main",                // function/CLI to call
    "args": ["--epochs", "{{params.epochs}}"],  // template: {{params.*}}
    "env": { "DATA_DIR": "{{env.dataDir}}" }
  },
  "notebook": {                          // NEW: an upstream Colab notebook
    "repo": "...", "path": "train.ipynb", "ref": "...",
    "paramsCell": 3,                     // cell index whose code maps to job params
    "outputsCell": "last"                // where the notebook writes results
  },
  // HOW to normalize the output into the standard bundle (single importer):
  "outputs": {                           // (existing) declared outputs
    "checkpoint": "out/model.onnx",
    "metrics": "out/metrics.json"
  },
  "adapter": "standardize-results",      // NEW: a normalization adapter id
  "adapterOptions": {                     // NEW: per-adapter config
    "modelRegex": "model\\.(onnx|tflite)$",  // find the model in the run dir
    "metricsParser": "openwakeword-json"       // how to parse metrics.json
  }
}
```

### 4.2 The adapter runs in three places (one code path)

| Where | What invokes the adapter | Notes |
|---|---|---|
| local-service | `train-runner.ts` (uv, ADR-028) | clones the pinned upstream ref into a cache, runs the upstream script, then normalizes outputs |
| CI `train-<module>.yml` | same `train-runner` path | one code path, two callers (ADR-028) |
| Colab | the notebook itself (a WakeStudio-provided cell) | see §5 |

### 4.3 Standardize-results adapter (the normalization contract)

`standardize-results` is the **single importer**: given a run's output dir (any
shape), it finds the model + metrics + provenance and produces the standard
bundle (§6). Adapters are per-upstream-project (openWakeWord, micro-wake-word,
wakeforge/ww_trainer, ...), each a small parser - the upstream artifact is
never changed. This is exactly the "we package, we do not invent" stance.

## 6. Artifact bundle manifest (single retrieval contract)

One manifest serves ALL backends - local-service, cloud, and Colab - so the PWA
has **one importer** that validates + imports any trained model:

```
wake-studio-results/<job-id>/
  model.onnx            (or model.tflite)
  metrics.json          (FAR/FRR, loss, epochs - for the quality report)
  metadata.json         (params used, backend, provider, dates)
  provenance.json       (license: user-owned / commercially clean; source data
                         attributions for the Phase 4 license gate)
  config.json           (AFE/KWS/Few-Shot config snapshot used for the training)
```

`metadata.json` shape:

```jsonc
{
  "jobId": "...",
  "moduleId": "...",
  "backend": "self-hosted" | "cloud" | "colab",
  "provider": "...",
  "params": { "...": "..." },
  "trainedAtMs": 0
}
```

`provenance.json` is the **license-gate input** (goal.plan Phase 4): it declares
the model commercially clean (trained = user-owned) or carries the third-party
license if the training wrapped a restricted model.

## 7. Google Colab (ADR-023) - output-retrieval convention

Colab is the fourth backend: the PWA opens a notebook, the user runs it in
their own Colab session, and **imports the results back**. Per §4, we **do not
rewrite** an upstream notebook - we adapt to it:

1. Upstream notebooks stay byte-identical; the module's `spec/train.notebook`
   declares which cell maps job params and which cell writes results.
2. A **WakeStudio-provided adapter cell** (prepended by the local-service / CI
   path, or the user pastes it into Colab) normalizes the notebook's output
   dir into the standard bundle (§6) via `standardize-results`.
3. The user downloads the bundle (zip from Drive / notebook file download).
4. The PWA's "Import Colab results" flow: pick a zip / Drive folder -> the
   importer validates against the manifest (`metadata.json` + `provenance.json`)
   and registers the model for in-browser testing + export.

No WakeStudio server is involved; the user's Google account is the only
credential (ADR-023).

## 8. Cloud Providers (ADR-013)

Per-provider adapters (AWS / GCP / HF / Alibaba / Tencent / Volcengine) behind
the common interface: submit job, poll status, download artifacts. Credentials
are **client-side only**, never sent to a WakeStudio server, never logged or
bundled into artifacts. The shared bundle manifest (§4) is the retrieval shape
for every provider. Capability labels: train-capable vs inference-only.

## 9. Provenance & licensing

- A trained model's `provenance.json` declares it user-owned / commercially
  clean - so the Phase 4 license gate treats it as exportable (unlike
  openWakeWord's CC BY-NC-SA pre-trained models).
- Generated audio (data-source layer, ADR-022) ownership is recorded per
  source.

## 10. Open questions [Q] - for human review

| ID | Question | Recommended default |
|---|---|---|
| T-1 | **local-service train: synchronous (current skeleton) vs async job + streaming** | Keep the synchronous skeleton for the module scaffolding (§6.5 Step B); add async queue + SSE streaming in goal.plan Phase 5. The PWA polls `GET /status`; a job id is added when the queue lands. |
| T-2 | **Colab import: zip upload vs Drive picker** | Start with zip upload (no Drive API dependency); Drive picker as an enhancement. |
| T-3 | **Artifact serving auth on a deployed self-hosted service** | Deferred to Phase 5 (per-deployment concern); localhost has no auth. |
| T-4 | **Where the bundle manifest lives in the PWA** | `packages/modules/training/core/manifest.ts` - the single importer used by all backends. |
| T-5 | **Which modules have a `train/` target in v1** | kws drivers (sherpa: transduce model frozen, so NO train - it's inference-only per ADR-024 ASR-Decoding; openwakeword: traditional train in Phase 5; plix: encoder is frozen). Training targets land with goal.plan Phase 5 backends. |
| T-6 | **Upstream-script adapters (§4): preserve scripts/notebooks as-is vs rewrite** | ✅ **RESOLVED (human, 2026-08-05): preserve.** WakeStudio adapts to the upstream artifact (declare invocation + normalize outputs), never rewrites it. Spec `train` gains `script`/`notebook` + `adapter`/`adapterOptions` fields. |

> T-5 note: per ADR-024, ASR-Decoding (sherpa) is **inference-only** - it has no
> train target. The training module's first real `train/` targets are the
> Traditional/MCU path (openWakeWord-style training, goal.plan Phase 5).

## 11. Change log

| Date | Change | Author |
|---|---|---|
| 2026-08-05 | Initial draft (docs-first, §6.5 Step A). | agent |
| 2026-08-05 | **§4 upstream-script adapters** (human decision: preserve upstream train.py/ipynb; adapt to them). Spec `train` gains `script`/`notebook`/`adapter` fields; `standardize-results` is the single importer. Sections renumbered. | agent |
