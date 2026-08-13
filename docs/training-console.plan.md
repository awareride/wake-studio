# Training Console — Panel Layout & Backend Control (review draft)

> **Status:** Draft for human review — design discussion captured; nothing implemented.
> **Scope:** Phase 5 "Custom-model training" — the Training view's panel
>   structure (stepper + history rail + guide) and two backend-control designs:
>   Colab-over-tunnel and Hugging Face.
> **Companion docs:** `docs/modules/training.md` (integration contract),
>   `docs/colab-training.plan.md` (Colab-first backend, decisions C-1..C-7),
>   ADR-013 (three backends), ADR-022 (data sources), ADR-023 (Colab),
>   ADR-025 (spec-driven panels).
> **Tracking:** issues #105 (panel), #106 (Q15 Colab tunnel), #107 (HF adapter).

---

## 0. Why this exists

The training module is spec-driven scaffolding only: a flat param form + a
no-op "Start training" action. Before Phase 5 backends land we need to fix two
things:

1. **The panel shape** — what the Training view actually looks like.
2. **Backend "control"** — the PWA needs a programmatic endpoint per backend.
   Colab today is user-driven (open notebook → run → download zip) with no way
   for the PWA to reach into the runtime.

The thread connecting both: **"control" = a real HTTP endpoint the PWA can talk
to.**

## 1. Panel layout — stepper + persistent history rail (decision)

Decision (human, "you pick the best"): a **stepper (wizard)** for the active
flow plus a **persistent history rail** on the left — not tabs.

Rationale: training is a linear, stateful pipeline — you cannot "run" before
"configure", and "review" only exists after "run". Tabs allow jumping around
and leaving a job half-configured with no sense of order; a stepper enforces
the sequence and can auto-advance when a job finishes.

| Feature | Where it lives |
|---|---|
| Train config | Step 1: Configure (spec params) |
| Backend readiness / connect | Step 2: Connect backend (see §2) |
| Training view | Step 3: Run / monitor (status + progress + logs) |
| Train history | **Left rail** (browsing, orthogonal to the flow — not a step) |
| Train guide | Inline tooltips + a collapsible "?" help drawer, not a tab |

Notes:

- The stepper wraps the existing spec-driven param panel (ADR-025); it is an
  app-layer container, not a replacement for generated panels.
- History is persisted (IndexedDB) and reachable at any time without walking
  the configure flow.

## 2. D1 — Colab control via a Cloudflare tunnel

**Proposal:** bring Colab "under control" by tunneling the Colab runtime to the
PWA with `cloudflared` — either a free `trycloudflare` URL or the user's own
named Cloudflare tunnel — instead of the current user-driven zip round-trip.

**The key insight: this collapses the Colab backend into the self-hosted API
shape.** The same `POST /train`, `GET /status`, `GET /artifacts/<name>`
contract `studio-backend` exposes (`docs/modules/training.md` §3) is served by
a small in-notebook server. One HTTP client, N backends — the PWA drives Colab
exactly like the self-hosted backend (same polling, same artifact download, no
manual zip round-trip).

### Mechanism

1. The notebook starts a small local HTTP server (FastAPI/uvicorn) on
   `localhost:PORT` implementing the studio-backend contract.
2. The notebook runs `cloudflared tunnel --url http://localhost:PORT` → prints
   `https://xxxx.trycloudflare.com`.
3. The user pastes that URL into the panel's "Connect" step.
4. The PWA drives Colab exactly like the self-hosted backend.

### trycloudflare vs named tunnel

| | trycloudflare | named tunnel |
|---|---|---|
| Account/key | none (matches ADR-023 "only the Google account") | user's own Cloudflare key/domain |
| URL | random, ephemeral, changes per run | stable |
| Fit | default v1 | "pro" upgrade for repeated use |

### Details

- cloudflared works from Colab: it makes an *outbound* connection to
  Cloudflare's edge, which Colab's sandbox allows. Install via
  `pip install cloudflared` or the static binary; no root needed.
- CORS: the in-notebook server sets `Access-Control-Allow-Origin: *` (we own
  it, so this is trivial). No mixed-content issue — PWA and tunnel are both HTTPS.
- Security: the URL is unguessable but treat it as public; never send
  credentials *through* it. Keys (Cloudflare token for a named tunnel) live in
  the notebook / Settings, not in the tunnel traffic.

### Risks (honest)

1. Colab kills idle runtimes → a long job can drop the tunnel. Mitigate:
   checkpoint/resume in the training script; notebook re-prints a fresh URL on
   reconnect.
2. Manual paste friction (ephemeral URL). Acceptable for v1; a named tunnel
   removes it.
3. trycloudflare rate-limits/ToS on heavy use → named tunnel for serious use.

**Decision gate:** amended ADR-023 ("the Colab runtime exposes the
studio-backend HTTP contract via an ephemeral Cloudflare tunnel"). ✅ **RESOLVED
(human, 2026-08-13): adopt — trycloudflare default, named tunnel opt-in**
(Q15, issue #106; recorded as an ADR-023 amendment).

## 3. D2 — Hugging Face is complementary, not a replacement

**Proposal:** HF is the *automated* cloud backend + durable model/dataset
store; Colab stays the *free compute* path. They play different roles in the
same loop.

| Axis | Colab (+ cloudflared) | Hugging Face |
|---|---|---|
| Control/automation | yes, after the tunnel trick | yes, native CORS-friendly API |
| Free GPU compute | yes | no (CPU free tier only) |
| Durable model/dataset + versioning | no (ephemeral) | yes (Hub repos + model cards) |
| Credential story | Google account only | user HF token (client-side, Settings) |

- HF gives a real API: with the user's token the PWA can create a model repo +
  dataset repo, upload artifacts, poll a job, and download — no tunnel, no
  paste. This is the "control" from §2 but native.
- HF is *not* free GPU compute, and wake-word training (the openWakeWord
  pipeline) is not a native AutoTrain/`Trainer` task — the bespoke script still
  runs in a Space/Job we set up. HF is the compute + storage layer, not a
  turnkey wake-word trainer.
- Nice synthesis: the Colab notebook (with tunnel) pushes the trained bundle to
  a HF repo, and the PWA always pulls from HF as the canonical retrieval.
  Colab = compute, HF = persistence, tunnel = control.

Note: HF is already on the ADR-013 cloud-provider list; this reframes its role
(it was deferred in `docs/colab-training.plan.md` C-4). No new ADR required —
this is a prioritization + role clarification. Tracked as issue #107.

## 4. How the pieces fit

The backend selector (Step 2) presents them honestly:

- **Colab** — free, manual-ish (tunnel connect), no credentials beyond Google.
- **Hugging Face** — automated, needs GPU/paid, user HF token.
- **Self-hosted** — local, full control, user runs Python.

## 5. Open questions

| ID | Question | Recommended default |
|---|---|---|
| T-7 | Panel: stepper auto-advance on job completion, or manual "Next"? | Auto-advance to Review on success; manual otherwise. |
| T-8 | History persistence: IndexedDB only, or also sync to backend when connected? | IndexedDB only for v1. |
| Q15 | Colab tunnel: adopt cloudflared (trycloudflare default, named tunnel opt-in)? | ✅ **RESOLVED (human, 2026-08-13): Yes — ADR-023 amended** (issue #106 closed). |

## 6. Change log

| Date | Change | Author |
|---|---|---|
| 2026-08-13 | Initial review draft — panel layout (stepper + history rail), Colab cloudflared tunnel (Q15, issue #106), HF complementary role (issue #107). | agent |
| 2026-08-13 | Q15 resolved (human): cloudflared tunnel adopted — trycloudflare default, named tunnel opt-in; recorded as an ADR-023 amendment (issue #106). | agent |
| 2026-08-13 | §1/§5 implemented (issue #105): Training console — stepper (Configure→Connect→Run→Review) around the spec-driven panel, IndexedDB history rail, collapsible help drawer; step/state logic in `packages/modules/training/core/steps.ts` (L1-tested); docs `training.md` §7.3. | agent |
| 2026-08-13 | §1 reworked per human design feedback (issue #105): list-detail layout (train list + train news + details pane) and a New-train wizard — choose model type (trainable modules from `train-modules.json`) → configure → choose train method (spec.train.invocation) → ready (.ipynb shown for review + download); guide mixed into each step; starting opens the train's review. | agent |
| 2026-08-13 | §1 refined (human feedback, issue #105): configs come from each module's own `spec.train.params` (schema extension, `trainPanelSpec` — nothing hard-coded in the training module); module-owned notebooks are served from the app's own origin (`public/train/<module-id>/`, no GitHub fetch); the .ipynb is previewed on the panel (read-only cells). | agent |
| 2026-08-13 | §1 polished (human feedback round 2, issue #105): wizard is a modal dialog; tunnel URL moves to the per-job details pane (generated at run time / auto-detected on import); module-owned Open-in-Colab removed; Colab CTA = "Save train"; manual-submit tips; upgraded notebook reviewer (markdown + line numbers + chapters). | agent |
