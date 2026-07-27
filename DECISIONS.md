# DECISIONS — Architecture Decision Records (ADR)

> This log records the decisions that shape WakeStudio. Each entry lists the
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
  RNNoise/WebRTC-based AFE is offered as an opt-in, WakeStudio-controlled
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

## ADR-008 — WakeStudio is open source; license chosen in Phase 0

- **Status:** Accepted (license chosen); superseding note below
- **Origin:** Plan Q8 (resolved by human: open source)
- **Decision:** WakeStudio is open source. **Chosen license: MIT** (see ADR-009).
- **Rationale:** Maximizes adoption and avoids copyleft friction with the
  permissively-licensed OSS components we integrate.

## ADR-009 — WakeStudio source license is MIT

- **Status:** Accepted (Phase 0 choice)
- **Origin:** ADR-008 follow-up
- **Decision:** All WakeStudio-authored source in this repository is licensed
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
- **Decision:** Model training in WakeStudio runs on one of three user-selected
  execution backends, behind a common "training job" interface so the PWA flow is
  identical regardless of backend:
  1. **In-Browser (WASM)** - 100% client-side; for browser-feasible light jobs
     (e.g. Few-Shot prototype computation). No credentials, no network.
  2. **Self-hosted Service** - the "Studio Engine" (ADR-005) packaged as a
     PyInstaller binary + Docker image, run locally on `localhost` **or deployed
     on Google Cloud**; the PWA connects to the user's own endpoint.
  3. **Cloud Training Provider** - managed ML platform of a selected provider:
     **AWS, Google Cloud, Hugging Face, Alibaba Cloud, Tencent Cloud, or
     Volcengine**. The user enters provider-specific credentials; WakeStudio
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
  sent to a WakeStudio server, never logged or embedded in exported artifacts
  (enforced by the Phase 5/6 security review). See `docs/architecture.md` §5 and
  plan §5.1 for the full credential/monitor/export flow.

## ADR-014 - Project name is WakeStudio

- **Status:** Accepted
- **Origin:** Naming review (resolved by human)
- **Decision:** The product is named **WakeStudio** (package/repo slug
  `wake-studio`), superseding the working name "WaveStudio".
- **Rationale:** The working name "WaveStudio" collides with **Creative
  Technology's "Creative WaveStudio"** - a long-standing audio-editing application
  bundled with Sound Blaster cards since 1992 and still distributed - in the same
  audio-software domain, creating trademark, SEO, and user-confusion risk.
  "WakeForge" was considered and rejected: it collides with
  **`TigreGotico/wakeforge`** (Python package `ww_trainer`), an active,
  NLnet/NGI0-funded wake-word training suite - a direct same-domain collision.
  "WakeStudio" leads with "Wake" (specific to the product's wake-word purpose),
  retains the familiar "Studio" suffix, and a collision search found no same-domain
  product. It is the same character length as "WaveStudio", so ASCII diagrams stay
  aligned.
- **Consequences:** Bulk rename across docs/UI/config in this change. The GitHub
  repository and Cloudflare Pages project should be created/renamed to
  `wake-studio` when set up (human action; no remote is configured yet). The
  `--project-name` in `.github/workflows/deploy.yml` still reads `wave-studio` and
  is flagged for explicit human authorization (a deploy-workflow change per
  `AGENTS.md`).

## ADR-015 - CI/CD activation is deferred to post-MVP

- **Status:** Accepted
- **Origin:** Human decision during Phase 0 validation
- **Decision:** CI/CD - reviewing/activating `.github/workflows/*`, configuring
  GitHub Pages + Cloudflare Pages secrets, and the first deploy - is deferred to
  post-MVP (targeted at the Phase 6 pre-release). The scaffolded workflow files
  (`ci.yml`, `deploy.yml`) remain in the repo but **dormant**: `deploy.yml` is
  manual (`workflow_dispatch`) and `ci.yml` only runs on push/PR to the remote,
  which is not yet in use. Local validation
  (`pnpm lint`/`typecheck`/`build`/`test:e2e`) remains the source of truth during
  the MVP build.
- **Rationale:** Focus effort on building the MVP; defer infra setup (Pages
  environment, Cloudflare secrets, workflow review) until the product is worth
  deploying. Avoids premature CI/CD tuning while the build is changing rapidly.
- **Consequences:** No automated CI guardrails during Phases 1-5; developers must
  run `pnpm lint && pnpm typecheck && pnpm build && pnpm test:e2e` locally before
  committing. The `deploy.yml` Cloudflare `--project-name=wave-studio` rename
  leftover (from ADR-014) is also deferred to the Phase 6 CI/CD activation. Phase
  6 Tasks updated to explicitly include CI/CD activation.

## ADR-016 - AFE Phase 1 design decisions

- **Status:** Accepted
- **Origin:** Phase 1 `docs/modules/afe.md` open questions Q-AFE-1..4 (resolved by human)
- **Decision:** Four AFE implementation choices are locked:
  1. **Topology (Q-AFE-1): configurable.** Support **both** a single
     `pipeline-processor` AudioWorklet (all stage DSP cores in one node) and a
     node-per-stage layout, selectable via `AFEConfig.topology`. The
     **single-worklet topology is implemented first** (lower latency: no inter-node
     buffer copying, shared WASM heap, one `postMessage` stream). This supersedes
     the plan's original "each an AudioWorklet node" wording.
  2. **RNNoise WASM port (Q-AFE-2): `@timephy/rnnoise-wasm`** (Apache-2.0 port of
     the BSD-3 RNNoise core).
  3. **Frame size (Q-AFE-3): configurable per engine.** `frameMs.aec` / `.bss` /
     `.ns` are set independently to accommodate WebRTC AEC3 vs RNNoise frame
     requirements; **default 10 ms** for all three. Stages buffer/resample
     internally when their frames differ.
  4. **BSS (Q-AFE-4): single-mic passthrough by default for v1.** 2-mic
     beamforming is an opt-in when a stereo mic array is detected. True BSS stays
     in exported demos (ADR-003).
- **Rationale:** Configurability avoids premature foreclosing of the node-per-stage
  option while shipping the lowest-latency path first. Per-engine frame size
  accommodates differing WASM-port frame requirements without a forced common
  frame. Single-mic passthrough matches real laptop hardware for v1.
- **Consequences:** Two topology code paths are eventually supported (single-worklet
  first; node-per-stage deferred). Per-engine frames require internal stage
  buffering. All tunables are surfaced in the Studio config panel (ADR-017).

**Amendment (2026-07-27) - AEC3, sample rate, VAD, vendoring:**
5. **WebRTC AEC3 deferred to v1.x.** No prebuilt AEC3 WASM npm package exists, and
   in-browser AEC on a laptop is weak (no real reference path). For v1 the AEC
   stage is **passthrough**; true AEC3 lives in exported demos (ADR-003). Revisited
   in v1.x. (Originally listed as a v1 dependency; corrected.)
6. **AFE DSP runs at 48 kHz.** RNNoise requires 480-sample frames at 48 kHz; the
   AFE runs AEC/BSS/NS at the 48 kHz AudioContext rate and resamples to 16 kHz
   only at the KWS output boundary (ADR-001's 16 kHz applies to the KWS input, not
   the AFE internals).
7. **VAD from RNNoise for v1.** `RnnoiseProcessor.processAudioFrame` returns a VAD
   score; Phase 1 uses it for the viz VAD curve. Silero VAD (onnxruntime-web) is
   deferred to Phase 2 for KWS gating - so Phase 1's only WASM dependency is RNNoise.
8. **Prebuilt WASM vendored into the repo.** The `@timephy/rnnoise-wasm@1.0.0`
   prebuilt JS (Apache-2.0; WASM embedded as base64 in `generated/rnnoise-sync.js`)
   is committed under `src/afe/vendor/rnnoise/` - no npm dependency, no runtime
   fetch (deterministic, offline-capable). Per human instruction: prebuilt WASM is
   pre-downloaded into the repo rather than fetched at runtime.

## ADR-017 - Studio provides a per-component parameter configuration panel

- **Status:** Accepted
- **Origin:** Human addition during Phase 1 AFE review
- **Decision:** The Studio (PWA UI) renders a **parameter configuration panel with
  default values for every component** (AFE, KWS, Few-Shot, Export, Training).
  Each module exposes its tunable parameters via a shared `describeParameters()`
  descriptor (id, label, type, default, min/max/step/options, unit, description);
  the UI renders controls generically from these descriptors, and values persist
  with sensible defaults so the app works out-of-the-box.
- **Rationale:** Gives users visible, adjustable control over each component's
  behavior without editing code; defaults keep the zero-setup experience (R2).
  A shared descriptor keeps the panel consistent across modules.
- **Consequences:** Every module doc's §6 (Configuration & constants) must declare
  its parameters via `describeParameters()`. The `docs/module-template.md` is
  updated to require this. The panel itself is built incrementally - the AFE panel
  lands in Phase 1, and each subsequent phase adds its component's panel.

## ADR-018 - KWS Phase 2 design decisions

- **Status:** Accepted
- **Origin:** Phase 2 `docs/modules/kws.md` open questions Q-KWS-1..4 (resolved by human)
- **Decision:** Four KWS implementation choices are locked:
  1. **Demo model (Q-KWS-1): `alexa.onnx`** (openWakeWord, CC BY-NC-SA, demo-only).
     Used for the Phase 2 in-browser demo only - never exported commercially (the
     Phase 4 license gate blocks it); Phase 5 trains a clean, commercially-ownable
     replacement. Already in `model-registry.json` as `class: demo-only`.
  2. **Inference thread (Q-KWS-2): Web Worker.** KWS inference runs off-main-thread
     to avoid blocking the UI (ONNX inference at 10 ms/frame can take 2-10 ms). The
     main thread owns the `KWSEngine` controller + visualization; the worker owns
     the ONNX sessions + inference loop; they communicate via `postMessage`.
  3. **Execution provider (Q-KWS-3): WebGPU-first with WASM fallback.** Feature-detect
     `navigator.gpu`; use WebGPU when available (faster), fall back to WASM
     automatically (universal). The config panel exposes the choice.
  4. **VAD source (Q-KWS-4): AFE's RNNoise VAD.** The AFE already provides
     `vadActive` (from RNNoise's VAD score) in `AFEOutputFrame` - free, no extra
     model. Silero VAD (a separate ONNX model, ~2 MB + compute) is deferred to
     v1.x when more accurate KWS gating is needed. The plan's "Silero VAD
     integration" task is superseded by "VAD gating via AFE's RNNoise VAD."
- **Rationale:** `alexa.onnx` is the simplest path to a working demo without
  waiting for Phase 5 training; the license gate makes it safe. Off-main-thread
  inference keeps the UI smooth. WebGPU-first gets the best perf where available
  while WASM guarantees universal support. Reusing the AFE's already-computed VAD
  avoids loading a redundant model and defers Silero complexity to v1.x.
- **Consequences:** The KWS module adds a Web Worker to the architecture
  (`src/kws/worker.ts`). WebGPU support varies by browser (Chrome/Edge yes;
  Firefox/Safari lag) - the WASM fallback handles this. The CC BY-NC-SA demo model
  must never enter a commercial export (enforced by the Phase 4 gate). Silero VAD
  remains in the model registry but is not loaded in v1.

---

_Open questions still pending human input: Q10 (self-hosted training engine) is
open for Phase 5. Q9 (training backends) is ADR-013; project name is ADR-014; CI/CD
deferral is ADR-015; AFE Phase 1 design is ADR-016; the config panel is ADR-017;
KWS Phase 2 design is ADR-018. Defaults from Q2/Q3/Q4/Q7 are applied per this log
and may be overridden._
