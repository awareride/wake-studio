# DECISIONS — Architecture Decision Records (ADR)

> This log records the decisions that shape WaveStudio. Each entry lists the
> decision, its status, the rationale, and any consequences. Append new
> decisions; never delete historical ones — supersede them.

Status legend: `Proposed` · `Accepted` · `Superseded` · `Deprecated`

---

## ADR-001 — Pipeline stages are strictly AEC → BSS → NS → KWS

- **Status:** Accepted
- **Origin:** Plan Q1 (resolved by human)
- **Decision:** The far-field voice front-end has exactly four stages in this
  fixed order: Acoustic Echo Cancellation → Blind Source Separation → Noise
  Suppression → Keyword Spotting.
- **Rationale:** Matches the standard naming used by ESP-SR, Infineon AFE, and
  XMOS voice-interface docs. Keeps scope bounded for v1.
- **Consequences:** Dereverberation and Automatic Gain Control are **out of
  scope for v1**. BSS is distinct from beamforming; the in-browser live demo may
  use a 2-mic beamforming approximation or passthrough, with true BSS running
  device-side in exported demos.

## ADR-002 — High-performance Few-Shot encoder is WavLM-base-plus (int8)

- **Status:** Accepted (default applied; human may override)
- **Origin:** Plan Q2
- **Decision:** The Few-Shot KWS track uses a frozen
  `microsoft/wavlm-base-plus` encoder (MIT license), quantized to int8 (~95 MB),
  with cosine-similarity prototype matching.
- **Rationale:** WavLM is the SUPERB KWS head and supports few-shot via embedding
  similarity. Fits the 30–100 MB RAM budget of a Linux gateway.
- **Consequences:** May be too large for the smallest Linux gateways. Mitigation:
  offer a distilled/quantized fallback and expose a RAM target in the UI
  (revisit in Phase 3). wav2vec2-base is the documented fallback.

## ADR-003 — Vendor AFE for reference demos; portable AFE as alternative

- **Status:** Accepted (default applied; human may override)
- **Origin:** Plan Q3
- **Decision:** Exported reference integrations lean on each vendor's own AFE
  (e.g. ESP-SR for ESP32, Infineon `audio-front-end` for PSoC). A portable
  RNNoise/WebRTC-based AFE is offered as an opt-in, WaveStudio-controlled
  alternative for cross-target consistency.
- **Rationale:** We do not compete with vendor tuning; we provide a unified
  baseline when a portable path is wanted.
- **Consequences:** Two AFE code paths to maintain per target. Per-target
  `LICENSES.md` required because vendor licenses differ.

## ADR-004 — Front-end is React + Vite + TypeScript

- **Status:** Accepted (default applied; human may override)
- **Origin:** Plan Q4
- **Decision:** PWA UI is React 18 + Vite 5 + TypeScript 5, styled with Tailwind
  CSS 3. `vite-plugin-pwa` provides the installable, offline-capable shell.
- **Rationale:** Safe defaults for team familiarity, PWA tooling, and a large
  ecosystem of audio/ML libraries.
- **Consequences:** Bundle is larger than a Svelte/Solid equivalent; acceptable
  for a developer tool, not a consumer app.

## ADR-005 — Studio Engine is a PyInstaller single binary (Docker optional)

- **Status:** Accepted
- **Origin:** Plan Q5 (resolved by human)
- **Decision:** The optional local "Studio Engine" (Traditional/MCU custom-model
  training) ships as a one-click PyInstaller native binary, with a Docker image
  as an alternative for CI/server use.
- **Rationale:** Broadest "just double-click" reach; the core user journey (live
  AFE, Few-Shot enrollment, export) never needs it.

## ADR-006 — First validated targets are ESP32-S3 and Linux/Raspberry Pi

- **Status:** Accepted
- **Origin:** Plan Q6 (resolved by human)
- **Decision:** The "golden path" export targets are ESP32-S3 (Domain A,
  microWakeWord + ESP-SR) and Linux/Raspberry Pi (Domain B, openWakeWord / WavLM
  Few-Shot + RNNoise/WebRTC).
- **Rationale:** Most open-source reference material exists for these two.

## ADR-007 — English only for v1

- **Status:** Accepted
- **Origin:** Plan Q7 (default applied)
- **Decision:** v1 ships English-only UI and English-only models, per the repo
  language policy. Non-English locale files are only added when explicitly
  scoped (e.g. `README.zh.md`).
- **Rationale:** Keeps scope and the license/data story bounded.

## ADR-008 — WaveStudio is open source; license chosen in Phase 0

- **Status:** Accepted (license chosen); superseding note below
- **Origin:** Plan Q8 (resolved by human: open source)
- **Decision:** WaveStudio is open source. **Chosen license: MIT** (see ADR-009).
- **Rationale:** Maximizes adoption and avoids copyleft friction with the
  permissively-licensed OSS components we integrate.

## ADR-009 — WaveStudio source license is MIT

- **Status:** Accepted (Phase 0 choice)
- **Origin:** ADR-008 follow-up
- **Decision:** All WaveStudio-authored source in this repository is licensed
  under the MIT License. A top-level `LICENSE` file is added.
- **Rationale:** Permissive, compatible with React/Vite/Tailwind/onnxruntime/
  RNNoise/WebRTC/Silero/WavLM. Note: this does **not** change the licenses of
  integrated third-party models — those retain their own terms (see
  `LICENSES.md`). Specifically, openWakeWord **pre-trained models are CC BY-NC-SA
  4.0** and must never enter a commercial bundle (enforced by the Phase 4 license
  gate).
- **Consequences:** We must train our own models (Phase 5) for any commercial
  export; we never redistribute the openWakeWord pre-trained models commercially.

## ADR-010 — Package manager is pnpm (via corepack)

- **Status:** Accepted
- **Origin:** Phase 0 tooling decision
- **Decision:** Use pnpm as the package manager. Pin the version through the
  `packageManager` field in `package.json` so corepack activates it
  deterministically. Track `pnpm-lock.yaml`; ignore npm/yarn lockfiles.
- **Rationale:** Plan validation criteria use `pnpm build`; pnpm is fast and
  strict about phantom deps. Corepack is bundled with Node, so no global install
  is strictly required (`corepack enable` once).
- **Consequences:** Contributors run `corepack enable` (or `npm i -g pnpm`)
  before `pnpm install`. CI activates pnpm through corepack.

## ADR-011 — Models are fetched lazily from a registry, never bundled

- **Status:** Accepted
- **Origin:** Phase 0 model-registry task
- **Decision:** A `model-registry.json` catalog (URL, checksum, license, tier,
  commercial-use flag) is served as a static asset and fetched on demand. No
  model weights are committed to the repo.
- **Rationale:** Respects third-party licenses, keeps the PWA bundle small, and
  makes the license gate possible (Phase 4).
- **Consequences:** The app needs network on first model use; Phase 6 caches
  fetched assets via the service worker for offline use.

## ADR-012 — Deploy base path is configurable via `VITE_BASE_PATH`

- **Status:** Accepted
- **Origin:** Phase 0 deploy wiring
- **Decision:** `vite.config.ts` sets `base` from the `VITE_BASE_PATH` env var
  (default `/`). The GitHub Pages deploy sets it to `/<repo-name>/`; the
  Cloudflare Pages deploy leaves it at `/`.
- **Rationale:** Project-page GitHub Pages need a sub-path; Cloudflare Pages
  serves at root. One config switch covers both.

## ADR-013 - Model training has three execution backends

- **Status:** Accepted
- **Origin:** Plan Q9 (resolved by human)
- **Decision:** Model training in WaveStudio runs on one of three user-selected
  execution backends, behind a common "training job" interface so the PWA flow is
  identical regardless of backend:
  1. **In-Browser (WASM)** - 100% client-side; for browser-feasible light jobs
     (e.g. Few-Shot prototype computation). No credentials, no network.
  2. **Self-hosted Service** - the "Studio Engine" (ADR-005) packaged as a
     PyInstaller binary + Docker image, run locally on `localhost` **or deployed
     on Google Cloud**; the PWA connects to the user's own endpoint.
  3. **Cloud Training Provider** - managed ML platform of a selected provider:
     **AWS, Google Cloud, Hugging Face, Alibaba Cloud, Tencent Cloud, or
     Volcengine**. The user enters provider-specific credentials; WaveStudio
     automatically executes training, monitors training status, and exports
     training artifacts within that service.
- **Rationale:** A single in-browser backend cannot cover heavy Traditional/MCU
  training (synthetic-data generation + PyTorch). Offering three backends keeps
  "zero setup" for light jobs and the primary live/enrollment/export journey
  (In-Browser) while giving users turnkey options (Self-hosted or Cloud) for heavy
  training without shipping Python into the browser.
- **Consequences:** Six cloud-provider integrations to maintain - abstracted behind
  one common training-job interface with one adapter per provider (mitigation in
  plan §9). Cloud-provider credentials are secrets held client-side only; never
  sent to a WaveStudio server, never logged or embedded in exported artifacts
  (enforced by the Phase 5/6 security review). See `docs/architecture.md` §5 and
  plan §5.1 for the full credential/monitor/export flow.

---

_Open questions still pending human input: none blocking Phase 0. Q9 (training
backends) is resolved as ADR-013. Defaults from Q2/Q3/Q4/Q7 are applied per this
log and may be overridden._
