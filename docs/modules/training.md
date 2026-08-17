# Training Module - Integration Contract (docs-first, §6.5 Step A)

- **Status:** Draft (awaiting human review - the train integration contract)
- **Owner:** WakeStudio team
- **Plan phase:** ADR-013 + docs/roadmap.md Phase 5
- **Related ADRs:** ADR-005 (self-hosted service), ADR-013 (training backends:
  Self-hosted / Cloud Providers / Colab), ADR-022 (data-source layer),
  ADR-023 (Colab backend), ADR-028 (uv train scripts), ADR-036 (self-hosted
  service = job-manager API)
- **Depends on (modules):** kws drivers (models to train), data-sources,
  export (provenance/license)
- **Last updated:** 2026-08-14

## 1. Purpose

Define the **training integration contract** before any code: how the PWA
submits a training job to each backend (Self-hosted Service, Cloud Providers,
Google Colab), how status is polled, and how the trained artifacts are
retrieved. This contract is locked **before** the training module's spec +
panel are built (§6.5 Step B). Backend implementations land in docs/roadmap.md
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
  status: 'queued' | 'running' | 'paused' | 'succeeded' | 'failed' | 'canceled'
  progress?: number             // 0..1 (from the last NDJSON progress line, §4.4)
  metrics?: Record<string, number> // latest metrics (loss etc.), forwarded from report lines
  logTail?: string              // recent log lines (also served by GET /jobs/{id}/logs)
  artifactBundle?: ArtifactBundleRef
  error?: string
  createdAtMs: number
  updatedAtMs: number
}

interface ArtifactBundleRef {
  // One shared bundle manifest is the single retrieval contract (§4).
  manifestUrl: string   // backend artifact URL (studio-backend) / cloud presigned URL / colab download
  sha256?: string
}
```

### 2.1 Backend capabilities

| Backend | submit | poll | retrieve | Credentials |
|---|---|---|---|---|
| Self-hosted (studio-backend, ADR-036) | `POST /jobs` (+ `POST /jobs/{id}/start`) | `GET /jobs/{id}` (+ `GET /stream` SSE) | `GET /artifacts/{job_id}/{name}` (sha256) | token on mutating endpoints (ADR-036 §5) |
| Cloud Provider | provider API (submit job) | provider API (status) | presigned/download URL | client-side only (ADR-013) |
| Colab | tunnel to the same studio-backend (§7.2, ADR-023 amendment) | same job endpoints | same artifact endpoints | user's Google account + tunnel URL |

## 3. Self-hosted Service - studio-backend job API (ADR-005 + ADR-036)

The PWA talks to the **studio-backend** (`apps/studio-backend`, Python /
FastAPI / uv, ADR-036) on `localhost` (`uv run wake-service`) or through the
Colab tunnel (§7.2). **The PWA drives jobs only** — the legacy module-train
endpoints are retired from the PWA contract (ADR-036 §2).

```
GET    /health                       -> liveness + GPU info (capability labels)
GET    /modules                      -> catalog (spec + targets; read-only)
GET    /jobs                         -> list jobs
POST   /jobs                         -> create + enqueue a job   [token]
GET    /jobs/{id}                    -> status + progress + metrics
POST   /jobs/{id}/start              -> start (or resume) a queued/paused job [token]
POST   /jobs/{id}/pause              -> pause (checkpoint-and-hold)          [token]
POST   /jobs/{id}/resume             -> resume from the last checkpoint      [token]
POST   /jobs/{id}/cancel             -> cancel; keep partial outputs          [token]
DELETE /jobs/{id}                    -> delete job + its artifacts            [token]
GET    /jobs/{id}/logs               -> recent log lines
GET    /artifacts/{job_id}/{name}    -> download (sha256 header, ETag)
GET    /stream                       -> SSE: job status events (fallback: polling)
```

**Auth (ADR-036 §5):** a static token (CLI `--token` / env `WAKE_SERVICE_TOKEN`,
set by the launcher, stored client-side per issue #52) is required on all
mutating endpoints (marked `[token]`). Read endpoints are open — the
trycloudflare URL is unguessable but public, so writes are protected and reads
are not. `/health` is always open.

**POST /jobs** body:

```jsonc
{
  "moduleId": "kws-openwakeword",
  "params": { "wakePhrase": "hey studio", "epochs": "10" }
  // backend-agnostic; forwarded to the module's train script as args
}
```

**Response** (202, async):

```jsonc
{ "id": "<client-or-server uuid>", "status": "queued" }
```

**Job lifecycle** (state machine):

```
new -> queued -> running <-> paused -> succeeded | failed | canceled
         |            \-- resume (from checkpoint) --/
```

**Execution model (ADR-036 §3):** each job is a child OS process (`uv run
<train script>` per ADR-028); the service supervises it and parses its stdout
as NDJSON report lines (§4.4). Single-concurrency by default (one GPU);
`--concurrency N` overrides. SQLite persists the queue + state across restarts
(§6.5 — a Colab runtime restart does not lose jobs; checkpoint/resume covers
idle drops per ADR-023).

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
  "notebookLocal": "packages/modules/kws/openwakeword/train/colab/train.ipynb",
                                          // NEW (ADR-035): a MODULE-OWNED Colab
                                          // notebook (repo-relative path). Distinct
                                          // from "notebook" (upstream): this one
                                          // lives in this repo; the generated panel
                                          // renders an "Open in Colab" action from it.
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
| studio-backend | `uv run <train script>` (ADR-028, ADR-036) | the studio-backend job manager spawns the script as a subprocess, parses its NDJSON reports (§4.4), then normalizes outputs |
| CI `train-<module>.yml` | the studio-backend runner path | one runner, two callers (ADR-028) |
| Colab | the notebook itself (a WakeStudio-provided cell) | see §5 |

### 4.3 Standardize-results adapter (the normalization contract)

`standardize-results` is the **single importer**: given a run's output dir (any
shape), it finds the model + metrics + provenance and produces the standard
bundle (§6). Adapters are per-upstream-project (openWakeWord, micro-wake-word,
wakeforge/ww_trainer, ...), each a small parser - the upstream artifact is
never changed. This is exactly the "we package, we do not invent" stance.

### 4.4 NDJSON reporting protocol (ADR-036 §3/§8)

The train script (or its adapter wrapping an upstream script, ADR-031) writes
**NDJSON report lines to stdout**. The service reads the pipe line-by-line and
updates the job — the stdout pipe is the IPC channel; no shared state, works
with any language:

```jsonc
{"event":"progress","step":2,"total":7,"progress":0.28,"message":"augmenting clips"}
{"event":"metrics","loss":0.12,"far":0.02,"frr":0.01}
{"event":"log","level":"info","message":"epoch 3/10 done"}
{"event":"heartbeat","at":"2026-08-14T10:00:00Z"}
{"event":"checkpoint","path":"out/checkpoint-3.pt"}
{"event":"artifact","path":"out/model.onnx"}
{"event":"error","message":"..."}
{"event":"done","exitCode":0}
```

- `progress` → job `progress` (0..1); `metrics` → job `metrics`; `log` → job
  `logTail` / `GET /jobs/{id}/logs`; `checkpoint` → resume point; `artifact` →
  a produced artifact (moved into the artifacts dir); `error`/`done` → final
  job state.
- **Heartbeat** is mandatory-ish: a `--heartbeat` CLI flag on the service sets
  the stale timeout (default 300s); a job with no heartbeat/`progress`/`log`
  line for that long is marked `failed` (hung-job detection), not left
  `running` forever.
- Adapters emit these lines by wrapping the upstream script's output (progress
  parsers per project); the script itself is never modified (ADR-031). The
  `train-kit` package (`wake_train_kit.report`) provides the reporter so
  module-owned scripts get this for free.

## 6. Artifact bundle manifest (single retrieval contract)

One manifest serves ALL backends - studio-backend, cloud, and Colab - so the PWA
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

`provenance.json` is the **license-gate input** (docs/roadmap.md Phase 4): it declares
the model commercially clean (trained = user-owned) or carries the third-party
license if the training wrapped a restricted model.

## 7. Google Colab (ADR-023) - output-retrieval convention

Colab is the fourth backend: the PWA opens a notebook, the user runs it in
their own Colab session, and **imports the results back**. There are two
notebook kinds (ADR-035):

- **Upstream** notebooks (third-party) — we **never rewrite**; we adapt to
  them. The module's `spec/train.notebook` declares which cell maps job params
  and which cell writes results.
- **Module-owned** notebooks (ours) — declared via `spec/train.notebookLocal`
  (repo-relative path). The **generated panel** renders an "Open in Colab"
  action (module-kit `buildColabUrl`, ADR-035); the user opens it directly
  from GitHub and runs it under their own account.

Common flow (both kinds):

1. The user opens/runs the notebook in their own Colab session.
2. A **WakeStudio-provided adapter cell** (prepended by the studio-backend / CI
   path, or the user pastes it into Colab) normalizes the notebook's output
   dir into the standard bundle (§6) via `standardize-results`.
3. The user downloads the bundle (zip from Drive / notebook file download).
4. The PWA's "Import Colab results" flow: pick a zip / Drive folder -> the
   importer validates against the manifest (`metadata.json` + `provenance.json`)
   and registers the model for in-browser testing + export.

No WakeStudio server is involved; the user's Google account is the only
credential (ADR-023). Optional notebook keys (Google API / TTS token) are
user-set in the Settings panel security section (issue #52), client-side only
(ADR-013), passed to the notebook as job params/env — never embedded.

### 7.1 Import Colab results — the PWA importer (issue #97)

The import half of the loop lives in `packages/modules/training/`:

- **`core/manifest.ts` → `importColabBundle(file)`** — the single client-side
  importer. It unzips the picked `wake-studio-results.zip` (via `fflate`, no
  server), matches files by basename (the zip prefixes entries with the job
  id), parses `metadata.json` + `provenance.json`, and returns an
  `ArtifactBundle`. On any invalid/missing part it throws a typed
  `BundleImportError` with a stable `code` (`missing-metadata`,
  `missing-provenance`, `invalid-metadata`, `invalid-provenance`,
  `missing-model`, `no-zip`, `empty-zip`) so the UI shows a precise message.
- **Validation** — `validateBundle` checks a non-empty job id, a metadata
  block with a known backend, and a provenance block carrying a license (the
  Phase 4 export-gate input). The Colab flow additionally requires
  `backend === 'colab'` and a model file (`hasBundleModel`).
- **Registration** (app layer, `apps/web/src/training/`) — on success the
  model binary is saved into the user model library under the `classifier`
  role (the existing KWS load path, ADR-024, consumes it for in-browser
  test), and a `train` provisioning artifact (ADR-033) persists the bundle
  metadata + provenance for the Phase 4 export gate. The app-level KWS
  model-source default for the classifier role is updated to point at the
  imported model, so the next Load in the KWS panel tests it immediately.
- **UI** — the PWA's new **Training** view hosts the training module's
  spec-driven panel plus the "Import Colab results" section (zip picker,
  clear errors, success summary).

Client-side only: the zip is parsed and validated entirely in the browser; no
WakeStudio server and no credentials are involved (ADR-013/023).

### 7.2 Colab runtime tunnel (Q15 — resolved, ADR-023 amendment)

Instead of only the manual zip round-trip, the notebook exposes the
studio-backend HTTP contract (§3) via a Cloudflare tunnel (`cloudflared`;
trycloudflare default, named tunnel opt-in), so the PWA drives Colab exactly
like the self-hosted backend. **This collapses the Colab backend into the
self-hosted API shape** — one HTTP client, N backends. ✅ **RESOLVED
(human, 2026-08-13): adopt** (issue #106); recorded as an ADR-023 amendment
in `DECISIONS.md`. Full design in `docs/training-console.plan.md` §2; the
URL is pasted in the training console's Connect step (§7.3).

### 7.3 Training console — train list + New-train wizard (issue #105)

The PWA's Training view is a list-detail console around the spec-driven panel
(ADR-025 — no hand-written controls):

- **Layout:** a persistent **train list** (left rail; each item carries the
  latest notification as a note) and a **details pane** (right) showing the
  selected train's status, **notifications**, results, and inputs review.
  **New train** opens the wizard; starting a train opens its review
  immediately. There is no global news feed — messages live with each train.
- **Wizard (4 steps, guide mixed into each panel, MODAL dialog so the left
  rail cannot interrupt it):**
  1. **Choose model type** — the trainable modules from the generated
     catalog `apps/web/public/train-modules.json` (spec-driven, ADR-025; built
     by `scripts/build-model-registry.mjs` from every `spec.train`).
  2. **Configure** — the module's train config card (from its spec.train: the
     differences between modules) + the module's OWN train params
     (`spec.train.params`, schema-extension; `trainPanelSpec` in
     `core/train-spec.ts` builds the panel spec) rendered through the
     generated panel — nothing is hard-coded in the training module. No
     params (e.g. frozen-weight rnnoise) → an empty form.
  3. **Choose train method** — the methods the module declares in
     `spec.train.invocation` (`methodsFor` in `core/methods.ts`): Google
     Colab / Self-hosted service / CI. Connection details (the Colab tunnel
     URL) are NOT asked here — they are generated when the train runs.
  4. **Ready to start** — the train summary (param labels from the module's
     spec) + the train input file shown as a compact card: for Colab the
     module-owned `.ipynb` with a **Review** button opening the full
     notebook dialog (rendered with `notebook-viewer-ts` — NotebookTs:
     markdown, code highlighting, outputs, Collapse/Expand) and download.
     The CTA lives in the wizard footer in the same position as Next: Colab
     = **Save** (the run happens in the user's Colab session; results come
     back in the details pane), studio-backend/ci = Start train.
- **Notebooks come from the app, not GitHub:** module-owned train files
  (`spec.train.notebookLocal` / `entry`) are copied into
  `apps/web/public/train/<module-id>/` by the registry script and served
  from the app's own origin — the WakeStudio repo only provides the
  template, never fetched at runtime (issue #105, human feedback). The
  notebook library is lazy-loaded (dynamic import) so highlight.js /
  micromark / katex stay out of the main bundle.
- **Colab finish flow (details pane, per job):** the tunnel URL is entered
  here once the notebook prints it (generated at run time; auto-detected on
  import when the notebook wrote it — Cloudflare API in Settings), or the
  user finishes manually by submitting the results zip. A tip switches
  between "tunnel set → status trackable" and "no tunnel → download + submit
  manually".
- **History model** — jobs recorded on Start (`core/history.ts` `startedJob`,
  with module + method) and on Colab import (`importedJob`); persisted in
  IndexedDB (`core/history-store.ts`). Step/state logic is pure and headless
  (`core/steps.ts`), L1-tested together with `core/methods.ts` and the
  per-train notifications (`deriveMessages`).


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
| T-1 | **studio-backend train: synchronous (current skeleton) vs async job + streaming** | ✅ **RESOLVED (human, 2026-08-14): async job-manager API adopted (ADR-036).** Jobs replace module endpoints; SSE `/stream` for realtime, `GET /jobs/{id}` polling as fallback; NDJSON reporting protocol (§4.4). |
| T-2 | **Colab import: zip upload vs Drive picker** | Start with zip upload (no Drive API dependency); Drive picker as an enhancement. |
| T-3 | **Artifact serving auth on a deployed self-hosted service** | ✅ **RESOLVED (human, 2026-08-14): token on mutating endpoints (ADR-036 §5);** read endpoints open (public-but-unguessable tunnel URL); artifact download stays open. |
| T-4 | **Where the bundle manifest lives in the PWA** | `packages/modules/training/core/manifest.ts` - the single importer used by all backends. |
| T-5 | **Which modules have a `train/` target in v1** | kws drivers (sherpa: transduce model frozen, so NO train - it's inference-only per ADR-024 ASR-Decoding; openwakeword: traditional train in Phase 5; plix: encoder is frozen). Training targets land with docs/roadmap.md Phase 5 backends. |
| T-6 | **Upstream-script adapters (§4): preserve scripts/notebooks as-is vs rewrite** | ✅ **RESOLVED (human, 2026-08-05): preserve.** WakeStudio adapts to the upstream artifact (declare invocation + normalize outputs), never rewrites it. Spec `train` gains `script`/`notebook` + `adapter`/`adapterOptions` fields. |

> T-5 note: per ADR-024, ASR-Decoding (sherpa) is **inference-only** - it has no
> train target. The training module's first real `train/` targets are the
> Traditional/MCU path (openWakeWord-style training, docs/roadmap.md Phase 5).

## 11. Change log

| Date | Change | Author |
|---|---|---|
| 2026-08-05 | Initial draft (docs-first, §6.5 Step A). | agent |
| 2026-08-05 | **§4 upstream-script adapters** (human decision: preserve upstream train.py/ipynb; adapt to them). Spec `train` gains `script`/`notebook`/`adapter` fields; `standardize-results` is the single importer. Sections renumbered. | agent |
| 2026-08-13 | §7.2 Colab runtime tunnel (proposal, Q15 issue #106): collapse Colab into the self-hosted API shape. | agent |
| 2026-08-13 | Q15 resolved (human): tunnel adopted — ADR-023 amended (issue #106). §7.3 added: Training console (stepper + history rail + guide, issue #105). | agent |
| 2026-08-13 | §7.3 reworked (human design feedback, issue #105): list-detail layout (train list + news + details pane) with a New-train wizard — model type (from `train-modules.json`) → config → method (spec.train.invocation) → ready (.ipynb review + download); guide mixed into each step; starting opens the train's review. | agent |
| 2026-08-13 | §7.3 refined (human feedback, issue #105): (1) train configs come from each module's own `spec.train.params` (schema extension; `trainPanelSpec`; training module no longer hard-codes params); (2) module-owned notebooks are copied to `public/train/<module-id>/` and served from the app — no GitHub fetch; (3) the .ipynb is previewed on the panel (cells rendered read-only). | agent |
| 2026-08-13 | §7.3 polished (human feedback round 2, issue #105): wizard is a modal dialog; `target` param removed from openwakeword; tunnel URL moved to the per-job details pane; module-owned Open-in-Colab removed; Colab CTA renamed to Save; manual-submit tips; upgraded notebook reviewer. | agent |
| 2026-08-13 | §7.3 refined (human feedback round 3, issue #105): notebook review uses `notebook-viewer-ts` (NotebookTs — markdown, hljs, outputs, folding) in a full Review dialog (lazy-loaded; no inline preview; Collapse-all/Expand-all + per-cell toggles); the news rail is gone — notifications/messages live in the train details pane and as a note on each train-list item; the wizard footer keeps Next's position for the final Save/Start button. | agent |
| 2026-08-13 | §7.3 polished (human feedback round 4, issue #105): modal dialogs use a stronger scrim (45% + blur — no back-content bleed during fast scroll); notebook review shows each cell's title when collapsed and flips − → +; the trigger is a compact **New** button with a wizard-wand icon; cleanup — training module spec slimmed (params/actions/status empty; the wizard owns the flow), outdated guide text fixed. | agent |
| 2026-08-13 | §7.3 refined (human feedback round 5, issue #105): the wizard is a FULL panel of the Training view (dialog removed; no left rail while it is open, so steps cannot be interrupted); notebook review — the −/+ button is the glyph alone and the collapsed cell's title is a proper title-like label (larger); syntax highlighting is on (the NotebookTs renderer runs highlight.js; the review CSS now carries the hljs token colors). | agent |
| 2026-08-13 | §7.3 polished (human feedback round 6, issue #105): (1) notebook review is a full panel of the train details/wizard with a Back button (state preserved); (2) wizard Cancel and leaving via another menu confirm when there is progress; (3) the Trains list header has a collapse/expand toggle; (4) step guide tips are collapsed by default (click the `>` to expand); (5) Back/Next/Save are pinned at the bottom — only the inner content scrolls; (7) train params are now REAL — each spec.train.params entry declares its notebook env var (`env`), and the app bakes the user's values into the downloaded .ipynb (and shows them in the review); (8) the repo-internal notebook path row was removed from the module config card. | agent |
| 2026-08-13 | §7.3 fixes (human feedback round 7, issue #105): the Trains toggle uses the sidebar-trigger style (IconMenu); the notebook review resets when switching trains (details are keyed by job id); personalized notebook cells keep their line breaks (the source array preserved trailing newlines — the `# --- WakeStudio job params` cell no longer collapses to a single line). | agent |
| 2026-08-13 | §7.3 fix (human feedback round 8, issue #105): the hamburger toggle now collapses the LEFT RAIL horizontally (sidebar-trigger behavior) — the train list hides and the details pane takes the full width; the toggle lives in the right-pane header so it stays reachable while the rail is hidden. | agent |
| 2026-08-13 | §7.3 polish (human feedback round 9, issue #105): notebook review code blocks WRAP (pre-wrap/break-word — long lines no longer overflow the panel width); the train-list toggle is mobile-aware — on small screens the rail is hidden and the hamburger opens a left-edge drawer (mirroring the shell's mobile sidebar); selecting a train closes the drawer and opens its details. | agent |
| 2026-08-13 | §7.3 fix (human feedback round 10, issue #105): the mobile train-list drawer now matches the global menu exactly — same `drawer-content` + slide-in/out animation classes, the default shell overlay (no custom scrim), and the toggle button matches the TopBar hamburger (no border/background). | agent |
| 2026-08-13 | §7.3 fix (human feedback round 11, issue #105): the wizard container uses a FIXED height (`h-[calc(100dvh-12rem)]`, not `max-h`) so the pinned Back/Next/Save footer stays at the same height regardless of the step/config content length. | agent |
| 2026-08-13 | §7.3 fix (human feedback round 12, issue #105): mobile footer went off-screen because the Training header wrapped taller — the header is now hidden while the wizard is open (the wizard has its own header + Cancel), so the chrome is constant and the pinned footer stays inside the viewport on both PC and mobile. | agent |
| 2026-08-13 | §7.3 polish (human feedback round 13, issue #105): the training panel is a fixed-height split-scroll area — the train list and the train details each scroll independently within the panel (the page itself no longer scrolls). Verified with 15 jobs: both columns scroll internally, body does not. | agent |
| 2026-08-14 | **§2/§3 rewritten + §4.4 added + T-1/T-3 resolved (ADR-036, human decision):** the self-hosted service becomes a Python FastAPI job-manager (`apps/studio-backend`, `uv run wake-service`); the PWA switches to jobs entirely (create/queue/start/pause/resume/cancel/delete, logs, artifacts, SSE); token auth on mutating endpoints; single-concurrency runner (CLI-configurable); SQLite persistence; NDJSON reporting protocol; subprocess-per-job execution model. The Node `apps/studio-backend` is removed; the Python service takes over the name (ADR-036 amendment, 2026-08-14). | agent |
| 2026-08-14 | **PWA training client switched to the jobs API (issue #122, ADR-036):** `apps/web/src/training/studio-client.ts` (create/poll/logs/actions/artifacts + SSE `/stream` with polling fallback); the self-hosted method submits `POST /jobs` at wizard time (Settings `backend.endpoint` + token); the Colab tunnel URL now **connects** — the job is submitted to the tunnel and tracked live (ADR-023 amendment, one HTTP client); live status shows progress/metrics/checkpoint/log-tail, lifecycle actions (pause/resume/cancel/delete) and artifact download links; `HistoryJob` gains `endpoint`/`submitted`/`progress`/`logTail`/`checkpoint` and the `paused` status. | agent |
| 2026-08-14 | **openwakeword train adapter shipped (issue #127):** `packages/modules/kws/openwakeword/train/train_adapter.py` — reads job params from `WAKE_*` env, writes the training YAML config, runs the upstream openWakeWord `train.py` UNCHANGED in 3 stages, streams output as NDJSON log lines, parses metrics, and normalizes into the standard bundle zip (same logic as the notebook's Steps 4–5). Spec gains `train.entry` + `studio-backend` invocation (wizard offers Studio-backend); `apps/studio-backend/registry.json` maps job params → `WAKE_*` env; notebook Step 1.5 points the tunnel at the adapter; 6 adapter tests (fake upstream train.py, no GPU). | agent |
| 2026-08-14 | **Backends menu (issue #130):** managed studio-backends replace the single Settings backend endpoint — name/baseUrl/token/kind (long-term vs short-term/Colab), auto health-check (`GET /health`, 30s poll) with online/offline status + lastSeen, read-only jobs (`GET /jobs`) + logs (`GET /jobs/{id}/logs`) detail, quick-start empty state (local `uv run wake-service` / openwakeword notebook Step 1.5 tunnel). The wizard's Studio-backend method now picks a managed backend (URL+token feed the jobs client; `HistoryJob.backendId`). `backend.endpoint` setting removed; apiKey/secret stay as the Colab-tunnel fallback token. Demo module **dry-run** (fake instant training, no GPU) lets the whole flow be checked locally. | agent |
| 2026-08-14 | **Backends panel v2 (Trains-style) + kind auto-detection:** the Backends view mirrors the Training console layout (toolbar `New` + `Free On Google Colab`, left rail + details pane). **Kind is detected from the API** — the service reports `instance` in `/health` (`wake-service --instance short-term`; the Colab launcher always starts `short-term`), and the health check updates the badge; the manual kind field is gone. `New` takes endpoint URL + access token only. `Free On Google Colab` generates a standalone studio-backend notebook client-side (review + download; run in Colab, paste URL + token). | agent |
| 2026-08-14 | **kws-streaming train adapter + data-source layer (#152):** `packages/modules/kws/streaming/train/train_adapter.py` runs the unpatched upstream `kws_streaming` trainer and normalizes into the standard bundle; `wake_train_kit/data_sources.py` adds Speech Commands V2 (CC BY 4.0), user-URL archives, and multi-language edge-tts synthesis; registry entry + fake-upstream tests. | agent |
| 2026-08-17 | **Mixed data sources (#158):** kws-streaming `dataSource=mixed` merges TTS positives (wake word) with real-speech unknowns + real noise (SC2 / user-url / none) via `merge_label_trees` — collision-safe, per-source provenance into `provenance.json`. | agent |
