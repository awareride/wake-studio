# Colab Training Backend Plan (review draft)

> **Status:** Draft for human review — nothing implemented yet.
> **Scope:** Phase 5 "Custom-model training" — stand up the **first real
> training backend** on **Google Colab**, producing a real, trainable model
> artifact that flows back into the PWA for in-browser test + export.
> **Intent:** start the train loop with **no self-hosted service** and **no
> cloud-provider credentials**, using only the user's free Google account.
> **Companion ADRs:** ADR-013 (three backends), ADR-022 (data-source layer),
> ADR-023 (Colab backend), ADR-028 (uv train scripts), ADR-024 (KWS categories /
> T-5 train targets). Contract home: `docs/modules/training.md`.

---

## 0. Why this plan exists

The training module is currently **scaffolding only**:

- `packages/modules/training/` has the spec + generated panel + the
  `manifest.ts` artifact-bundle importer — but **no real train engine**.
- `apps/studio-backend/` has `train-runner.ts` (the `uv`/self-hosted path) but
  it is a skeleton and depends on a locally-run server + Python/PyTorch.
- There is **no module-owned Colab notebook** and **no cloud-provider adapter** yet.
- No real train script exists in the repo: PLiX and sherpa encoders are frozen
  (ADR-024 inference-only), so the only trainable line is the **Traditional /
  MCU path** (openWakeWord-style).

**The human constraint (2026-08):** *no resources to self-host.* So the first
real backend should be **Colab** — free compute, no WakeStudio server, no
provider credentials, just the user's Google account. This is exactly the
design intent of ADR-023. This plan makes training *actually run* by picking
one backend + one engine and closing the loop end-to-end.

---

## 1. Goals

| # | Goal | Plan section |
|---|---|---|
| 1 | A real, runnable training notebook lives in the module's `train/colab/` | §4 |
| 2 | It trains a wake-word model from a phrase using synthetic data (Piper TTS + augmentation) | §4 |
| 3 | The trained result normalizes into the **standard artifact bundle** (ADR-013 §6) | §5 |
| 4 | The PWA's existing `manifest.ts` importer pulls the bundle back in ("Import Colab results") for in-browser test + export | §7 |
| 5 | No WakeStudio server, no provider credentials involved | whole plan |
| 6 | The module advertises its Colab notebook via `spec.json` (no hand-written registration) | §5 |
| 7 | HF as a cloud-provider adapter is **deferred** (noted, not built) | §8 |

**Non-goals for this slice:** the self-hosted service, cloud-provider adapters,
the async job queue (T-1), and the data-source layer's full endpoint config.
This is the minimal vertical slice that makes training real.

---

## 2. Backend choice — why Colab first

| Backend | Setup cost | Free? | Fits "no self-host" constraint? |
|---|---|---|---|
| **Self-hosted** (`studio-backend`) | local server + Python/PyTorch | runs on your hardware | ❌ rejected (human) |
| **Cloud Provider** (HF, …) | provider credentials + per-provider adapter | HF has a free tier | ⚠️ more work, later (§8) |
| **Colab** | open notebook, run, download | ✅ free GPU | ✅ **Chosen** |

Colab is the lowest-friction real backend and is already an accepted design
(ADR-023). Notebooks are version-controlled inside the owning module's
`train/colab/` (§4).

---

## 3. Engine decision (Q10, issue #32) — recommended: openWakeWord app-class

The Traditional/MCU path is the only trainable line today. Q10 is still open.

| Engine | Tier / output | Notes |
|---|---|---|
| **openWakeWord** | app-class, ONNX | natural first target, most documented, easiest end-to-end win |
| **micro-wake-word** | MCU, TFLite-Micro | matches `target: mc` default; heavier MCU path |
| **wakeforge / `ww_trainer`** | (Q10 candidate) | evaluate later behind the same adapter contract |

**Recommended default:** start with **openWakeWord app-class** — shortest path
to a model that trains and comes back. The adapter contract (§6) is engine-
agnostic, so micro-wake-word and wakeforge can reuse it later.

---

## 4. Deliverable 1 — module-owned training notebook (openWakeWord)

The WakeStudio-authored wrapper notebook lives **inside the module** (module-ownership, ADR-025):

```
packages/modules/kws/openwakeword/train/colab/train.ipynb
```

It is a version-controlled, module-owned notebook that:

1. **Sets up** the pinned upstream `openWakeWord` training environment
   (ADR-028 `uv`/pip, pinned ref).
2. **Generates synthetic data** for the wake phrase using Piper TTS +
   augmentation (the ADR-022 data-source layer) — fully inside Colab.
3. **Runs the upstream train script** bytes-identical (per the "we adapt to
   the script, not vice versa" rule, `docs/modules/training.md` §4).
4. **Writes results** into the standard bundle layout (§6).

The notebook is **not rewritten upstream code** — it is a WakeStudio wrapper
that invokes the upstream trainer and normalizes the output.

---

## 5. Deliverable 2 — spec-driven Colab invocation (how the panel finds the notebook)

The module advertises its Colab notebook in **`spec.json`** — the single shared
fact source (ADR-025) — so the generated panel renders an "Open in Colab"
action with **no hand-written per-driver registration**.

### 5.1 Two distinct notebook kinds (do not conflate)

| Kind | Owner | Where | Spec field |
|---|---|---|---|
| **Upstream** notebook (third-party, we adapt to it) | external repo | referenced, not stored | `train.notebook` (existing: `repo`/`path`/`ref`) |
| **Module-owned** wrapper notebook (ours) | WakeStudio | `train/colab/` | **new** `train.notebookLocal` |

**Decision (human, 2026-08-11): separate fields.** C-6 resolved —
`notebook` vs `notebookLocal` stay distinct; no `source` discriminator.

`schema.json` already has `train.invocation: ["colab"]` and `train.notebook`;
this slice adds `train.notebookLocal` — a **repo-relative** path to the
module-owned wrapper (matches the existing `playground.entry` / `tests.*`
path convention; the GitHub→Colab URL builder needs the repo path and cannot
derive the module dir from `meta.id` reliably).

### 5.2 How the panel opens it (no server, no credentials)

The generated panel builds the GitHub→Colab URL from the module's repo + the
local path in spec:

```
https://colab.research.google.com/github/<org>/<repo>/blob/<ref>/<train.notebookLocal>
```

The user runs the notebook in their own Colab session; WakeStudio never hosts
it. This is the "submit" half of the Colab adapter (ADR-013 §2.1).

### 5.3 Optional keys: user-set in Settings

Colab itself needs **no WakeStudio credential** — the user's Google account is
the only auth (ADR-023). But a notebook may need an optional key (Google API
key for Drive import, a public TTS endpoint token from the data-source layer,
etc.). Policy (human, 2026-08-11):

- The user sets such keys in the app's **Settings panel — security section**
  (issue #52: data-driven Settings, secrets, localStorage-backed).
- Keys are **client-side only** (ADR-013 security note): never logged, never
  embedded in exported bundles, never sent to a WakeStudio server.
- The key is passed to the notebook as a **job param / env var** (the
  `{{params.*}}` / `{{env.*}}` template in `spec.train`, `docs/modules/training.md`
  §4.1), pasted or read from the notebook's runtime env by the user.

### 5.4 Why spec, not registration

- **ADR-025:** spec is the single shared fact source; panels are generated,
  never hand-written.
- **ADR-030/033 (registration)** is for runtime driver capabilities — a static
  notebook path is declarative metadata, not a runtime seam. Mixing it in
  would force per-driver panel code, which the module platform forbids.
- The same `notebookLocal` field is readable by CI/studio-backend later
  (docs/modules/training.md §4.2) without new discovery code.

## 6. Deliverable 3 — artifact-bundle normalization (the loop's contract)

The notebook's output dir is normalized into the **standard bundle manifest**
(`docs/modules/training.md` §6) via the `standardize-results` adapter:

```
wake-studio-results/<job-id>/
  model.onnx            (or model.tflite)
  metrics.json          (FAR/FRR, loss, epochs)
  metadata.json         (jobId, moduleId, backend='colab', params, trainedAt)
  provenance.json       (license: user-owned / commercially clean — Phase 4 gate)
  config.json           (AFE/KWS/Few-Shot config snapshot)
```

The single importer is the existing `manifest.ts`; the notebook only needs to
lay the files down in this shape. `provenance.json` declaring the model
**user-owned / commercially clean** is what lets the Phase 4 license gate treat
it as exportable (unlike openWakeWord's CC BY-NC-SA pre-trained models).

---

## 7. Deliverable 4 — "Import Colab results" in the PWA

Reuse the existing `TrainingJob` interface (ADR-013) + `manifest.ts` importer:

1. User picks the downloaded bundle (zip) in the app.
2. The importer validates against the manifest (`metadata.json` +
   `provenance.json`).
3. The model registers for **in-browser test** (existing KWS load path) +
   **export** (Phase 4 license gate).

No WakeStudio server is involved; the user's Google account is the only
credential (ADR-023).

> **Status (issue #97): implemented.** `importColabBundle` (fflate, typed
> `BundleImportError` codes) + hardened `validateBundle` live in
> `packages/modules/training/core/manifest.ts`; the app's **Training** view
> hosts the import section, registers the model into the user library
> (classifier role) + a `train` artifact (ADR-033), and updates the KWS
> model-source default. L1 tests cover the importer (module) and the
> registration glue (app). Docs-synced with `docs/modules/training.md` §7.1.

---

## 8. Deferred (noted, not built now)

- **Cloud Provider adapter (HF free tier)** — later, behind the same common
  interface / bundle manifest.
- **Self-hosted** `studio-backend` training — later / when resources allow.
- **Async job queue + SSE streaming** (T-1) — Colab is user-driven, no polling.
- **Data-source layer full endpoint config** — this slice uses only the
  in-notebook Piper generation.

---

## 9. Sequencing & dependencies

- This slice is **independent of the P0 delivery blockers (#27–30)** and
  **Phase 4 (SDK/export)** — it does not need them resolved to run.
- Docs-first: update `docs/modules/training.md` (§4.2/§5/§7) **and** the
  `module-spec.schema.json` (`train.notebookLocal`) in the same change as the
  notebook (docs-sync rule).
- The existing `manifest.ts` importer is reused; no new retrieval contract.

---

## 10. Open questions for review

| # | Question | Recommended default |
|---|---|---|
| C-1 | Engine: openWakeWord (app-class) vs micro-wake-word (MCU) vs wakeforge? | ✅ **RESOLVED (human, 2026-08-11): openWakeWord app-class first** (§3) |
| C-2 | Colab import: zip upload vs Drive picker? | ✅ **RESOLVED (human, 2026-08-11): zip upload first** (T-2 default) |
| C-3 | Which upstream `openWakeWord` ref to pin for the notebook? | ✅ **RESOLVED (human, 2026-08-11): latest tagged release, pinned in the notebook** |
| C-4 | Should this slice also scaffold the HF cloud-provider adapter (free tier)? | ✅ **RESOLVED (human, 2026-08-11): No — defer** (§8) |
| C-5 | Spec field name for the module-owned notebook | ✅ **RESOLVED (human, 2026-08-11): `train.notebookLocal`** (§5) — **repo-relative** path (matches `playground.entry`/`tests.*` convention) |
| C-6 | Distinguish upstream vs module-owned notebooks by separate fields, or a `source` discriminator? | ✅ **RESOLVED (human, 2026-08-11): separate fields** (`notebook` vs `notebookLocal`) |
| C-7 | Notebook keys (Google API key / TTS token) — how does the user provide them? | ✅ **RESOLVED (human, 2026-08-11): Settings panel security section** (issue #52), client-side only, passed as job params/env (§5.3) |

---

## 11. Change log

| Date | Change | Author |
|---|---|---|
| 2026-08-11 | Initial review draft — Colab-first training backend (openWakeWord, synthetic Piper data, standard bundle import). | agent |
| 2026-08-11 | Notebook moved into the owning module (`train/colab/`, ADR-025 module-ownership); advertised via new `spec.train.notebookLocal` (spec-driven panel, no hand-written registration) — §4/§5, questions C-5/C-6. | agent |
| 2026-08-11 | **C-6 resolved:** separate fields (`notebook` vs `notebookLocal`). **C-7 added & resolved:** optional notebook keys (Google API / TTS) are user-set in the Settings panel security section (issue #52), client-side only, passed as job params/env — new §5.3. | agent |