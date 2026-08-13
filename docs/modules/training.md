# Training Module - Integration Contract (docs-first, §6.5 Step A)

- **Status:** Draft (awaiting human review - the train integration contract)
- **Owner:** WakeStudio team
- **Plan phase:** ADR-013 + docs/roadmap.md Phase 5
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
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled'
  progress?: number             // 0..1
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
| Self-hosted (studio-backend) | `POST /modules/:id/train` | `GET /modules/:id/status` | `GET /modules/:id/artifacts/<name>` | none (localhost trust) |
| Cloud Provider | provider API (submit job) | provider API (status) | presigned/download URL | client-side only (ADR-013) |
| Colab | open notebook (ADR-023) | user-driven (no polling) | import bundle from Drive/zip | user's Google account |

## 3. Self-hosted Service - studio-backend API (ADR-005)

The PWA talks to `apps/studio-backend` on `localhost`. The skeleton server
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
| studio-backend | `train-runner.ts` (uv, ADR-028) | clones the pinned upstream ref into a cache, runs the upstream script, then normalizes outputs |
| CI `train-<module>.yml` | same `train-runner` path | one code path, two callers (ADR-028) |
| Colab | the notebook itself (a WakeStudio-provided cell) | see §5 |

### 4.3 Standardize-results adapter (the normalization contract)

`standardize-results` is the **single importer**: given a run's output dir (any
shape), it finds the model + metrics + provenance and produces the standard
bundle (§6). Adapters are per-upstream-project (openWakeWord, micro-wake-word,
wakeforge/ww_trainer, ...), each a small parser - the upstream artifact is
never changed. This is exactly the "we package, we do not invent" stance.

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
     back in the details pane), subprocess/ci = Start train.
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
| T-1 | **studio-backend train: synchronous (current skeleton) vs async job + streaming** | Keep the synchronous skeleton for the module scaffolding (§6.5 Step B); add async queue + SSE streaming in docs/roadmap.md Phase 5. The PWA polls `GET /status`; a job id is added when the queue lands. |
| T-2 | **Colab import: zip upload vs Drive picker** | Start with zip upload (no Drive API dependency); Drive picker as an enhancement. |
| T-3 | **Artifact serving auth on a deployed self-hosted service** | Deferred to Phase 5 (per-deployment concern); localhost has no auth. |
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
| 2026-08-13 | §7.3 polish (human feedback round 14, issue #105): the rail toggle moved into the TRAINS header (with a count badge); the bulk Clear button is gone — each train deletes itself via Details → Operations → Delete (confirm dialog; the imported model stays in the model library). When the rail is hidden, a small re-open control appears in the details pane. | agent |
