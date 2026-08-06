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

## ADR-002 — High-performance Few-Shot encoder is PLiX (supersedes WavLM-base-plus)

- **Status:** Accepted (default applied; human may override)
- **Origin:** Plan Q2
- **Decision:** The Few-Shot KWS track uses a frozen
  `aaqibsaeed/plixkws` encoder (Apache-2.0), a compact CNN
  (EfficientNet-v2 "base" / TinyNet-E "small") trained as a Prototypical
  Network; scoring is squared-Euclidean distance to the mean prototype
  (rescaled to [0,1]). Replaces the earlier WavLM-base-plus choice below.
- **Rationale:** WavLM-base-plus (~95 MB int8, 95M-param Wav2Vec2 front) was
  too heavy for end-side / IoT devices. PLiX is purpose-built for few-shot
  spoken-word detection on resource-constrained hardware and is far smaller,
  while still supporting enrollment with a handful of support clips.
- **Consequences:** The encoder expects a 1x64x100 log-Mel spectrogram front-end
  (16 kHz, window 400 / hop 160, 60–7800 Hz). The "small" TinyNet-E variant
  is offered for the lowest-RAM targets.

> **Superseded (2026-07-28):** the original ADR-002 selected
> `microsoft/wavlm-base-plus` (MIT, int8 ~95 MB) with cosine-similarity
> prototype matching. That choice was overturned because the model's footprint
> is excessive for end-side deployment; PLiX is the replacement.
> Original decision (kept for history):
> - **Decision:** frozen `microsoft/wavlm-base-plus` encoder (MIT), int8 (~95 MB),
>   cosine-similarity prototype matching.
> - **Rationale:** WavLM is a strong KWS head and supports few-shot via embedding
>   similarity; fits a 30–100 MB RAM budget of a Linux gateway.
> - **Consequences:** may be too large for the smallest gateways; mitigation was a
>   distilled/quantized fallback (Wav2Vec2-base documented).

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

## ADR-006 - First validated targets are ESP32-S3 and Linux/Raspberry Pi

- **Status:** Superseded by ADR-019
- **Origin:** Plan Q6 (resolved by human)
- **Decision:** The "golden path" export targets are ESP32-S3 (Domain A,
  microWakeWord + ESP-SR) and Linux/Raspberry Pi (Domain B, openWakeWord / PLiX
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
  RNNoise/WebRTC/Silero/PLiX. Note: this does **not** change the licenses of
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

**Amendment (2026-07-27) - offline pre-fetch of assets:**
6. **Assets (WASM, ONNX, and other runtime artifacts) are pre-fetchable locally.**
   In addition to lazy on-demand fetch, the PWA offers a **pre-fetch / bulk-download**
   path so a user can pull all (or a selected subset of) registry assets ahead of
   time and run fully offline thereafter. The model-registry catalog (URL, checksum,
   license, tier, commercial-use flag) is the single source of truth for both lazy
   fetch and pre-fetch; pre-fetched assets are integrity-checked against the same
   checksums. No weights are committed to the repo. *Operational rule:* if a
   registry/asset download fails, the agent stops and asks the human rather than
   retrying blindly or guessing a mirror.

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

**Amendment (2026-07-27) - in-browser training removed; Cloud Providers unified; Colab added:**
1. **In-Browser (WASM) is no longer a *training* backend.** Any step that learns
   weights or trains a classifier runs only on the Self-hosted Service, a Cloud
   Provider, or Colab. The browser path is retained **only for inference and
   Few-Shot enrollment** (prototype mean-pooling + cosine scoring), which is
   enrollment/inference, not training (Q2 boundary, confirmed by human). This
   supersedes original backend #1 from the *training* set.
2. **"Cloud Training Provider" is unified as "Cloud Providers" with capability
   labels** (train-capable vs inference-only); the provider list (AWS, Google
   Cloud, Hugging Face, Alibaba Cloud, Tencent Cloud, Volcengine) is unchanged.
3. **Google Colab is added as an independent fourth backend** (ADR-023): notebook
   execution under the user's own Google account, with results exported back to
   the PWA.
4. Training-data sourcing (including audio generation) is handled by the pluggable
   data-source layer (ADR-022), **not** in-browser WASM.

  The amended training-backend set is therefore: (1) Self-hosted Service,
  (2) Cloud Providers (capability-labeled), (3) Colab. In-Browser (WASM) remains
  an execution surface for client-side inference + Few-Shot enrollment only.

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
  1. **Demo model (Q-KWS-1): `hey-buddy`** (`benjamin-paine/hey-buddy`, CC-BY-4.0,
     commercially clean). **Amended** - originally planned as openWakeWord
     `alexa.onnx` (CC BY-NC-SA, demo-only); switched to hey-buddy (commercially
     clean, browser-first) so the demo model can also serve as a redistributable
     export baseline. Used for the Phase 2 in-browser demo; the Phase 4 license
     gate still applies to any CC-BY-NC-SA model added later.
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

## ADR-019 - Export target matrix is the full cross-device set; Cortex-M is the primary MCU tier

- **Status:** Accepted
- **Origin:** Human product-direction update (supersedes ADR-006)
- **Decision:** WakeStudio's validated export targets are the full cross-device
  set, all built on the device-side SDK (ADR-021):
  - **Arm Cortex-M** (STM32, Arduino) - primary MCU tier.
  - **Raspberry Pi** (Zero, 3, 4, 5) - app-class edge.
  - **Android** and **iOS** - mobile.
  - **Browsers**: Chrome, Safari, Firefox, Edge - via the SDK's JS/WASM binding.
  - **Linux** (x86_64), **macOS** (x86_64, arm64), **Windows** (x86_64, arm64) -
    desktop.
  - **ESP32-S3** is retained as a **deferred extended target** (Xtensa, not
    Cortex-M); micro-wake-word + TFLite-Micro still run on it, but it is not on
    the golden path.
- **Rationale:** The product's core capability is to export application templates
  for *all* mainstream targets from MCU to desktop/browser/mobile. Cortex-M
  (STM32, Arduino) is the primary MCU tier because micro-wake-word + TFLite-Micro
  have first-class Cortex-M support; ESP32 is retained but deferred to avoid
  splitting early validation across architectures.
- **Consequences:** Supersedes ADR-006's "ESP32-S3 + Linux/Pi golden path." The
  per-target export matrix in `docs/architecture.md` §6 and the device SDK
  (ADR-021) are the mechanisms that make the broad matrix tractable - each target
  is an SDK adapter, not a one-off codepath. ESP-SR (ESP32) stays in `LICENSES.md`
  for the deferred target; the original STM32/TI rows are superseded by the
  Cortex-M tier (TI drops off the v1 list).

## ADR-020 - KWS is a pluggable-backend interface; openWakeWord, micro-wake-word, PLiX Few-Shot, and PocketSphinx are adapters

- **Status:** Accepted
- **Origin:** Human product-direction update
- **Decision:** WakeStudio's KWS layer is a `KWSBackend` interface with pluggable
  adapters, not a single hardcoded engine:
  - **openWakeWord** (Apache-2.0 code; CC BY-NC-SA pre-trained models, demo-only) -
    app-class targets (Pi, desktop, mobile, browser). **Relatively large:** its
    feature stack (melspectrogram ~1.1 MB + Google `speech_embedding` ~1.3 MB +
    classifier + onnxruntime) is, per upstream, "likely still too large for
    micro-controllers."
  - **micro-wake-word** (Apache-2.0) - MCU tier (Cortex-M: STM32, Arduino; also
    ESP32). TFLite-Micro streaming int8 models, tens of KB. Synthetic-data
    training, like openWakeWord.
  - **PLiX Few-Shot** (Apache-2.0) - app-class; enrollment-based, prototype-distance
    scoring (ADR-002). Prototype computation + inference stay client-side
    (ADR-013 amendment).
  - **PocketSphinx** (CMU Sphinx, BSD-style; bundles WebRTC VAD under BSD-3) -
    lightweight classic HMM/GMM; viable on MCU-class and above as a lightweight /
    alternative backend.
- **Rationale:** openWakeWord is too large for the MCU tier and for some
  constrained targets; a single engine cannot span Cortex-M to desktop/browser.
  A pluggable interface lets WakeStudio select the right backend per target and
  per wake word, and makes future backends straightforward to add. PocketSphinx is
  evaluated as the lightweight alternative to openWakeWord.
- **Consequences:** Phase 2 implementation resumes against this `KWSBackend`
  interface; `docs/modules/kws.md` will be updated to define the interface at that
  point (Phase 2 was paused per Q5). A size/latency/accuracy evaluation of
  openWakeWord vs micro-wake-word vs PocketSphinx is recorded per target in the
  KWS module doc. The browser demo may use any backend; the Phase 4 license gate
  still blocks CC-BY-NC-SA pre-trained models from commercial exports.
  PocketSphinx is added to `LICENSES.md` (Redistributable).

## ADR-021 - A layered portable device-side SDK underpins every export workflow

- **Status:** Accepted
- **Origin:** Human product-direction update
- **Decision:** WakeStudio develops a **layered portable device-side SDK**, and
  **all export workflows are built upon it** (superseding the per-target one-off
  adapter approach in the original Phase 4 plan). Layers:
  1. **Core (C/C++):** the `KWSBackend` interface (ADR-020), a portable AFE
     (RNNoise/WebRTC, ADR-003/016), audio-I/O + threading + clock abstractions,
     and VAD. Target-agnostic.
  2. **Target adapters:** per-platform implementations of the abstractions (audio
     capture, model runtime, threading) for each target in ADR-019.
  3. **Language bindings:** JS/WASM (browsers), Kotlin (Android), Swift (iOS),
     Python (Linux/macOS/Windows), C/TFLite-Micro (Cortex-M, ESP32).
  4. **Bundle generation (Phase 4):** each export is an SDK-based project (model +
     AFE config + SDK adapter + `demo/` + `README.md` + `LICENSES.md` + `test/`),
     zipped client-side.
- **Rationale:** Spanning Cortex-M, Raspberry Pi, mobile (Android/iOS), desktop
  (Linux/macOS/Windows), and browsers from one product requires a shared SDK; the
  in-browser PWA also uses the same `KWSBackend` interface (via the JS/WASM
  binding) so the demo and exports are consistent. A shared core prevents N
  divergent codepaths and keeps the license/quality story uniform.
- **Consequences:** Phase 4 is reshaped from "five one-off export kits" to "SDK
  adapters + bundle generation." `docs/modules/sdk.md` is the new module doc for
  the SDK contract (stub now; filled at Phase 4 start per the docs-first rule).
  The SDK is MIT (WakeStudio source); per-target `LICENSES.md` still applies
  because vendor/model licenses differ.

## ADR-022 - Audio generation / training data is a pluggable data-source layer, not in-browser WASM

- **Status:** Accepted
- **Origin:** Human product-direction update
- **Decision:** Training-data sourcing - including auto-generated spoken audio
  samples and platform pre-built resources (public datasets, project-organized
  datasets) - is a **pluggable data-source layer** with in-app endpoint
  configuration. Sources are: (a) **local services**, (b) **project server
  APIs**, and (c) **general public TTS online endpoints**. Audio generation
  **does not run inside WASM**; it runs in the selected training backend
  (Self-hosted Service, Cloud Provider, or Colab - ADR-013 amendment) or is
  fetched from the configured endpoints.
- **Rationale:** Synthetic-data generation (Piper-class TTS + augmentation) and
  dataset management are too heavy and too license-sensitive to run in the
  browser. A pluggable, configurable layer lets users point WakeStudio at their
  own data/TTS endpoints and mix platform-provided datasets with generated audio,
  while keeping generation out of the WASM bundle.
- **Consequences:** `docs/modules/data-sources.md` is the new module doc for the
  data-source contract (stub now; filled at Phase 5 start). The Phase 5 training
  flow consumes this layer. Piper's GPL-3.0 / archived-MIT status (see
  `LICENSES.md`) is handled at the backend, not in the browser; generated audio
  owned by the user feeds commercially-ownable models.

## ADR-023 - Google Colab is an independent training / audio-generation backend

- **Status:** Accepted
- **Origin:** Human product-direction update (adds a fourth backend to ADR-013)
- **Decision:** **Google Colab** is an independent training and audio-generation
  execution backend. WakeStudio provides IPython notebooks that the user runs in
  their own Colab session (under their own Google account / Drive): the notebook
  performs training and/or audio sample generation, and **results are exportable
  afterward** (model artifacts `.onnx`/`.tflite` + metadata, generated audio) back
  into the PWA for in-browser testing and export.
- **Rationale:** Colab gives users GPU compute and a familiar notebook environment
  with no local install and no WakeStudio-hosted server - a strong fit for users
  who want managed compute without provider credentials. It is distinct from the
  Cloud Providers (managed training APIs) and the Self-hosted Service (the user's
  own endpoint).
- **Consequences:** Colab is the fourth execution backend in ADR-013 (amended).
  The common training-job interface (ADR-013) gains a Colab adapter whose
  "submit" is "open notebook + run" and whose "retrieve" is "download artifacts
  from Drive / notebook output." No WakeStudio server is involved; the user's
  Google account is the only credential. Notebooks are version-controlled in the
  repo (e.g. under `colab/`).

---

## ADR-024 — KWS is organized into three categories with a decoupling rule and a unified panel spec

- **Status:** Accepted
- **Origin:** Human product spec (KWS categories & unified control panel)
- **Decision:** WakeStudio's KWS support is organized into exactly three categories —
  **Traditional Fixed-Class KWS** (train + inference), **ASR Decoding KWS**
  (inference only, editable text wake-word list), and **Few-Shot Meta-Learning KWS**
  (multi-weight inference only). Each category has an explicit functional scope
  (§2 of `docs/kws-categories.md`) and a future extensibility reserve for later
  fine-tuning/training. A hard **decoupling rule** holds: adding a new KWS type or
  model project requires only an independent driver module + a matching config
  panel, with **no modification to shared underlying modules**. All panels follow
  a **dual-layer** layout (Primary + collapsible Advanced), and the frontend
  consumes a single standardized inference-event shape regardless of KWS type.
- **Rationale:** Keeps the platform extensible as new open-source KWS projects are
  integrated (P0: `ARM-software/ML-KWS-for-MCU`, `swagshaw/TorchKWS`,
  `k2-fsa/sherpa-onnx`, `plixkws`) without destabilizing shipped categories. The
  three categories map cleanly onto the existing `KWSBackend` seam (ADR-020), the
  shared AFE preprocessing (ADR-018), the lazy model manager (ADR-011), and the
  `describeParameters()` panel renderer (ADR-017).
- **Consequences:** The existing code already satisfies two of three categories
  (Traditional via OpenWakeWord; Few-Shot via PLiX). **ASR Decoding is not yet
  implemented** and is the next driver-module + panel addition under this rule.
  Training/fine-tuning for ASR-Decoding and Few-Shot are explicitly reserved for
  later iterations as new driver modules + panels; they do not alter the shared
  contracts. The canonical spec lives in `docs/kws-categories.md`.

---

## ADR-025 — WakeStudio is a platform of self-contained modules with a config-driven panel generator

- **Status:** Accepted (2026-07-31: monorepo layout + device/ location decided;
  panel generator + RNNoise pilot pending)
- **Origin:** Human product/architecture direction (2026-07-31 discussion)
- **Decision:** All functional areas (AFE components, KWS backends, Few-Shot,
  Training, Data sources, Export) become **self-contained modules**. A module is
  the unit of delivery, testing, and extension — it owns everything its function
  needs, and the rest of the app interacts with it only through a declared
  contract. The repo is a **pnpm workspace monorepo** hosting four worlds — web
  (apps/web PWA), local service (apps/local-service Node API), device
  (device/, C/C++ CMake build tree), and train scripts (per-module train/ dirs)
  — see `docs/architecture.md` §3.1–§3.2.
- **Module definition (a module is complete when ALL of these exist):**
  1. **Core logic** (engine/backend), usable headlessly — no UI dependency.
  2. **Config spec** — a declarative `ModuleSpec` (JSON Schema; see
     `docs/module-spec.md`) describing params, actions, status, runtime shape,
     build recipe, and test requirements.
  3. **Auto-generated panel** — rendered by the shared panel generator from the
     spec, never hand-coded. Replaces today's hard-coded per-component panels
     (AFEPanel / KWSPanel / FewShotPanel / TrainingPanel).
  4. **Full test coverage** — unit (L1, vitest) + wasm-runtime (L2, Node) +
     e2e (L3, Playwright) per the testing ADR (ADR-026).
  5. **Playground page** — a standalone route where the module's function can
     be experienced without the rest of the app.
  6. **Multi-target deliverables** — whatever is needed beyond the web app:
     local service (Node), cloud build (GitHub Actions), and device SDK glue
     (ADR-021), as applicable. "As applicable" is judged per module, not
     mandated wholesale.
- **Module boundary rules:**
  - A module depends on the **platform layer** (`src/platform/*`: audio IO,
    wasm loader, runtime abstraction) and on **declared interfaces** of other
    modules only — never on another module's internals.
  - Adding a module must not require editing shared modules (extends the
    ADR-024 decoupling rule to all modules).
  - Shared pure logic (DSP) may live in a module and be imported by other
    modules' *tests*, but cross-module runtime imports go through the declared
    contract. **Amended by ADR-032 (2026-08-06):** shared *numeric* DSP now
    lives in `@wake-studio/dsp` (the platform DSP package); modules import it
    instead of defining their own.
- **Monorepo layout (2026-07-31):**
  - `apps/web` (PWA), `apps/local-service` (Node API, the Self-hosted training
    backend of ADR-005), `packages/contracts` (shared types + schemas),
    `packages/module-kit` (panel generator / playground router / spec
    validator), `packages/test-kit` (L2 wasm runner), `packages/modules/*`
    (functional modules), `packages/sdk` (device SDK, ADR-021), and a top-level
    `device/` root for the C/C++ build tree.
  - **Device world lives in top-level `device/`**, separate from the JS world:
    module `device/` directories are pulled into its CMake build tree via
    `add_subdirectory`, not npm. Rationale: the C toolchain (CMake/compilers)
    is a different build system; mixing it into pnpm workspaces adds nothing.
  - Contracts (`packages/contracts`) are the only cross-module dependency
    surface; per-target package exports (`./web` `/node` `/spec` `/train`
    `/device`) keep each world importing only what it needs.
- **Panel generator:** `renderPanel(spec) -> React component` is a pure function
  over `ModuleSpec`; the existing `ParameterDescriptor`/`describeParameters()`
  (ADR-017) becomes the per-parameter leaf of the spec. Two or three panel
  layouts (classification, pipeline, training) cover all current modules.
- **Maturity scoring:** each module carries a public scorecard
  (core / spec / panel / tests / playground / targets) so "Complete" means
  something measurable. The README status table will be generated from these
  scorecards, not hand-maintained (fixes the current over-optimistic statuses).
- **Rationale:** The "uncontrollable" feel of the project comes from modules
  being shipped at very different levels (some are engines, some are UI shells,
  some are doc stubs) with no per-module definition of done. Self-contained
  modules with a spec + generator + scorecard make each module independently
  verifiable and extendable, and make the roadmap legible.
- **Consequences:**
  - Migration is incremental: one **pilot module first** (RNNoise — small,
    vendored wasm, no Python) to validate the full module lifecycle, then the
    rest. No big-bang rewrite.
  - `docs/modules/*.md` evolve into module specs; `docs/module-spec.md` defines
    the schema; `docs/build-artifacts.md` (ADR-027) defines the CI build SOP;
    the testing ADR (ADR-026) defines L1/L2/L3; train scripts use uv
    (ADR-028).
  - Hand-written panels are deleted as their modules migrate to the generator.
- **Status of this ADR:** Accepted (2026-07-31). The monorepo layout, the
  `device/` root, and per-target module exports are decided. The panel generator
  and the RNNoise pilot are the next concrete steps.

---

## ADR-026 — Three-layer testing: unit (L1), local wasm runtime (L2), browser e2e (L3)

- **Status:** Accepted (implemented; L2 in the rnnoise module, per-module L1 in every module)
- **Origin:** Human architecture direction (2026-07-31 discussion, Q6)
- **Decision:** Testing is organized into three layers, run at different
  frequencies:
  - **L1 Unit (vitest, Node/JSDOM):** pure logic — DSP, matching, state
    machines, smoothing/trigger rules. No runtime/model dependencies. Runs on
    every PR (already the case; 102 tests today).
  - **L2 WASM runtime (Node):** the emscripten/ONNX artifacts are loaded in a
    **local Node process** and exercised directly — compile the wasm, init the
    runtime, load the model, run one inference pass over a synthetic clip. This
    verifies "the artifact actually boots and produces output" in seconds,
    without a browser and without a 55 MB fetch. Runs on every PR.
  - **L3 Browser e2e (Playwright):** full UI flows in a real browser. Slow
    (large wasm fetches), so it runs on merge/PR only after L1+L2 pass, and at
    a lower cadence (e.g. before merging to `main`, or nightly).
- **Rationale:** Today, verifying "the sherpa-onnx-kws wasm boots" requires the
  180-second browser e2e (which fetches ~55 MB); that is too slow and too
  flaky to gate every change. The emscripten glue the project already uses
  supports `ENVIRONMENT=node`, and sherpa-onnx ships Node bindings, so an L2
  runner is nearly free — it is the same wasm file, loaded by Node instead of a
  browser.
- **Consequences:**
  - Each module with wasm/onnx artifacts ships an L2 runner
    (`<module>/tests/wasm-runtime.test.ts`) that loads the artifact from
    the module's `assets/` and asserts boot + one inference pass.
  - L3 becomes the gate for merge to `main`, not for every PR.
  - L2 does **not** replace L3: thread/SharedArrayBuffer behavior differs
    between Node and browsers; the browser e2e remains the authority for
    browser-only semantics (this is exactly the pitfall noted in the
    sherpa-onnx-kws commit).
- **Status of this ADR:** Accepted. Implemented: rnnoise L2 wasm-runtime test;
  per-module L1 suites (10 modules, ~158 tests). L2 for sherpa/plix wasm is a
  follow-up (currently e2e-only).

---

## ADR-027 — External artifacts are built in GitHub Actions and synced locally via a standard fetch SOP

- **Status:** Accepted (implemented; generic build skeleton + fetch-artifact, 2026-08-05)
- **Origin:** Human architecture direction (2026-07-31 discussion, Q5)
- **Decision:** Every externally-built artifact (wasm, onnx, models) follows a
  **standard build-and-fetch SOP**, formalizing what the project already does
  ad-hoc:
  1. **Build in CI, not on the dev machine.** The **generic build skeleton**
     `.github/workflows/build.yaml` builds any module's artifact via its spec
     `build` block (script, toolchains, inputs) — the workflow never pre-knows
     the parameters (ADR-027 §6.7, module-migration plan). `main` stays
     protected. Existing bespoke workflows (sherpa/plix) were folded into it
     (2026-08-05).
  2. **Artifacts are never committed** (ADR-011). The workflow uploads them as
     a downloadable artifact.
  3. **Sync to local via a standard fetch script** — `scripts/fetch-artifact.mjs
     <module-id>` (shared, generic; reads the module spec's build.artifactName),
     or `scripts/fetch-<name>.mjs` for bespoke cases. `pnpm fetch:all` runs all
     module fetch scripts. The fetch script pins the expected artifact (name +
     hash) and verifies what it downloaded.
  4. **Registry:** `public/model-registry.json` is extended to carry, per
     artifact: version, source workflow, hash, fetch command, date. It is the
     single source of truth for "what artifact should be present locally."
  5. **Fail loudly when missing:** if a module's artifact is absent at runtime,
     the UI shows the exact fetch command instead of failing silently.
- **Canonical SOP:** `docs/build-artifacts.md`.
- **Rationale:** The project already has the correct bones (3 workflows, a
  fetch script, gitignored assets); what is missing is the standard
  job/format/signature so every future artifact is handled identically and the
  developer never guesses how to obtain it.
- **Consequences:**
  - New module with a build step gets: spec `build` block + `scripts/build-<id>.mjs`
    + fetch via `scripts/fetch-artifact.mjs` + registry entry + missing-asset
    error message. Nothing hand-rolled in `.github/workflows/`.
  - Artifact version bumps are explicit (hash in registry + fetch script),
    making stale-wasm regressions diagnosable.
- **Status of this ADR:** Accepted. Implemented: generic `build.yaml` skeleton,
  `scripts/build-module.mjs` (driver), `scripts/fetch-artifact.mjs`,
  module-spec `build` block (script/toolchains/inputs). The bespoke sherpa/plix
  workflows were folded in; the dynamic dispatch-input bridge is a follow-up.

---

## ADR-028 — Module train scripts use `uv` (Astral) for Python environment management

- **Status:** Accepted (implemented in the RNNoise pilot)
- **Origin:** Human product direction (2026-07-31 discussion, Q: Python env for
  train scripts)
- **Decision:** Module `train/` scripts declare their Python environment in a
  `pyproject.toml` (or a thin `requirements.txt` for simple modules) and are run
  through **`uv run`** (Astral, Rust, single binary). No conda, no per-module
  venv management by hand, no Docker required for local runs. Docker remains an
  option for CI isolation but is not the default local path.
- **Rationale:** `uv` is a drop-in replacement for pip/venv/poetry with fast,
  hermetic, cacheable environments; one static binary installs in seconds and it
  exists on GitHub-hosted runners and on the dev machine. It shields the repo
  from "it works on my machine" Python drift: the exact interpreter + pinned deps
  are declared next to the script, and `uv run` resolves them deterministically.
  Lightweight (no Docker daemon, no image build) and cross-platform.
- **Consequences:**
  - Module `train/` must contain a `pyproject.toml` (or `requirements.txt`) and
    a `train.py` (or `train.sh` wrapping `uv run python train.py`).
  - The local service's `train-runner.ts` invokes `uv run --project <module>/train
    python train.py ...` in a working directory the module owns; output artifacts
    (checkpoint, metrics) are written under the module's `out/` and registered in
    `model-registry.json` (ADR-027).
  - CI `train-<module>.yml` invokes the same command on a runner with `uv`
    installed (`astral-sh/setup-uv`), so local and CI share one code path.
  - Docker is **not** required; modules may add a `Dockerfile` only when they
    need GPU/system deps that `uv` alone cannot provide.
- **Status:** Accepted.

---

## ADR-029 — The AFE is a set of per-stage modules plus a graph orchestration module

- **Status:** Accepted (2026-08-05; supersedes the single-graph-module reading of §6.2)
- **Origin:** Human correction during the module migration (each AFE stage is a
  module with pluggable implementations; RNNoise is one NS implementation)
- **Decision:** The AFE is NOT one module. Four modules:
  - `afe-aec` (v1 passthrough; WebRTC AEC3 future),
  - `afe-bss` (v1 single-mic passthrough; beamforming future),
  - `afe-rnnoise` (one NS implementation; the shipped pilot module),
  - `afe-graph` (pure orchestration AEC→BSS→NS over the `AFEStage` interface,
    owns the AudioWorklet scheduling; no stage DSP).
  A new AEC/BSS/NS implementation plugs in behind `AFEStage` (contracts) without
  editing the graph (ADR-024/025 decoupling).
- **Consequences:** contracts gained `AFEStage`/`AFEStageResult`; the graph's
  worklet imports stage modules headlessly (worklet-safe loader sub-entry,
  no React in the bundle); a later stage implementation is a new module.

## ADR-030 — The KWS layer is an engine module plus per-backend driver modules

- **Status:** Accepted (2026-08-05; Q-K1 resolved)
- **Origin:** Human decision during the module migration (split per backend for
  independent single-module testing/evaluation)
- **Decision:** The KWS layer is `kws-engine` (KWSEngine, worker loop,
  `KWSBackend` interface, registry seam) + one driver module per backend:
  `kws-openwakeword`, `kws-sherpa` (main-thread transducer), `kws-plix`
  (EmbedProvider + prototype-distance). Drivers self-register via
  `registerKwsBackend`; sherpa uses `mainThreadFactory` (classic emscripten
  wasm needs DOM); plix registers the embed-provider factory. Asset paths are
  module-owned (`assets/`, Q-K2); `meta.id` is unique kebab (dir basename
  may differ, e.g. `kws-engine`).
- **Consequences:** adding a backend = a new driver module + registration, no
  engine edits (ADR-024). Each driver is independently tested/scorecared.

## ADR-031 — Training adapts to upstream scripts/notebooks, not vice versa

- **Status:** Accepted (2026-08-05)
- **Origin:** Human decision during the training-contract review (preserve
  upstream `train.py` / `.ipynb`; adapt to them)
- **Decision:** Upstream training artifacts stay byte-identical; WakeStudio
  wraps them with an adapter layer. `spec/train` gains `script` (pinned
  upstream repo script: repo/path/ref/language/entrypoint/args) or `notebook`
  (paramsCell/outputsCell) plus `adapter`/`adapterOptions`. The
  `standardize-results` adapter (`ResultsAdapter`) normalizes ANY upstream run
  output into the standard artifact bundle (single importer). This matches the
  product principle "select, integrate, harden, and package" — we never fork
  or rewrite third-party training code.
- **Consequences:** `ModuleTrain.entry` is optional (local uv script vs
  upstream script vs notebook); contracts/schema extended; local-service
  train-runner handles the adapter path. Full adapter implementations land in
  goal.plan Phase 5.

---

## ADR-032 — Platform DSP package (@wake-studio/dsp) replaces hand-written FFT/DSP

- **Status:** Accepted (implemented 2026-08-06)
- **Origin:** Human decision (2026-08-06 discussion): DSP/FFT is core to the
  project's future (AEC/BSS/NS, mel front-ends, spectrograms); needs a
  long-term reliable, reusable solution, not per-module hand-written code.
- **Decision:** A new platform-level package `packages/dsp`
  (`@wake-studio/dsp`) owns the numeric DSP layer:
  1. **FFT core is `fft.js`** (MIT, indutny) - a battle-tested pure-JS radix-4
     FFT (dependency-free, no DOM/wasm, AudioWorklet-safe). We do NOT
     hand-write the FFT.
  2. **STFT/ISTFT, windows, Slaney mel filterbank, melSpectrogram, resample,
     level meters** are thin TS wrappers in the package, pure and
     context-agnostic (Node, browser, worker, AudioWorklet).
  3. **Correctness is anchored by conformance fixtures** generated from
     scipy/numpy (`scripts/gen-conformance-fixtures.py`, committed under
     `tests/fixtures/`): FFT vs `scipy.fft.fft`, STFT vs
     `scipy.signal.stft`, mel vs the PLiX `backbone.py` math. Any refactor
     that drifts numeric behavior fails CI.
  4. **Migration:** `plix-frontend.ts` mel front-end and the AFE graph viz
     spectrum now delegate to the package; their hand-written radix-2 FFTs
     are deleted. `few-shot` RMS/SNR helpers are unchanged (no FFT).
  5. **Removed module-level DSP (2026-08-06 follow-up):** the duplicated
     `levelDb` in afe-aec/afe-bss/rnnoise AFE-stage, the `frameRms`/`applyGain`
     in rnnoise, and the `peakDbfs`/`rmsDbfs`/`isClipped`/`estimateSnrDb` in
     few-shot all now live in `@wake-studio/dsp` (re-exported for call-site
     compatibility). No module contains a numeric DSP implementation anymore;
     what remains in-module is domain logic (KWS smoothing/trigger, cosine
     similarity, VAD mapping), not DSP.
  6. **Renamed non-DSP files (2026-08-06):** `afe/rnnoise/core/dsp.ts` ->
     `constants.ts` (RNNOISE_FRAME_SIZE, vadToProbability, dsp re-exports);
     `few-shot/core/dsp.ts` -> `quality.ts` (cosine similarity,
     sample-quality checks); `kws/engine/core/dsp.ts` -> `logic.ts`
     (ScoreSmoother/TriggerDetector/VAD gate - decision logic, not DSP).
     `afe/graph/core/dsp.ts` was moved into `@wake-studio/dsp` as
     `spectrum.ts` (computeSpectrum + test helpers) - the graph module now
     has no in-module DSP file at all. Its `l1` test covers the module's own
     pure logic (defaults/constants/parameter descriptors,
     `tests/defaults.test.ts`), per the module-self-testing rule.
- **Rationale:** (a) eliminates three duplicated hand-written FFTs and the
  PLiX/openWakeWord front-end drift risk; (b) the FFT core is a mature
  third-party implementation that can be fully audited; (c) higher-level
  behavior is pinned by Python-reference fixtures, so "reliable" is a test
  guarantee, not a code review promise; (d) one seam (`createFft`) allows a
  future SIMD/wasm backend for AEC3/beamforming without touching call sites.
- **Consequences:**
  - `plix` and `afe-graph` gain a workspace dependency on `@wake-studio/dsp`.
  - New DSP functionality (AEC3 NLMS, beamforming, ISTFT) builds on this
    package rather than in-module.
  - WASM is deliberately NOT used for FFT now (pure-JS is far below the
    real-time budget, e.g. ~0.008 ms/256-pt FFT); RNNoise remains the only
    DSP-stage wasm. If a future stage needs more, the `createFft` seam
    supports a wasm backend.
  - Conformance fixtures require Python (scipy/numpy) only when regenerating;
    the committed fixtures keep the JS test suite Python-free.

---

_Open questions still pending human input: Q10 (self-hosted training engine) is
open for Phase 5. Q9 (training backends) is ADR-013 (amended: in-browser training
removed, Cloud Providers unified, Colab added as ADR-023); targets are ADR-019
(supersedes ADR-006); pluggable KWS backends are ADR-020; the device-side SDK is
ADR-021; the data-source layer is ADR-022; the module platform is ADR-025
(Accepted - monorepo + module layout); testing layers are ADR-026 (Accepted -
L1 per module, L2 in rnnoise, L3 browser); build-artifact SOP is ADR-027
(Accepted - generic build.yaml + fetch-artifact); train scripts use uv (ADR-028,
Accepted). The AFE is per-stage modules (ADR-029), the KWS layer is engine +
per-backend drivers (ADR-030), and training adapts to upstream scripts/notebooks
(ADR-031). Project name is ADR-014; CI/CD deferral is ADR-015; AFE Phase 1
design is ADR-016; the config panel is ADR-017; KWS Phase 2 design is ADR-018
(resumes against the `KWSBackend` interface). Defaults from Q2/Q3/Q4/Q7 are
applied per this log and may be overridden._
