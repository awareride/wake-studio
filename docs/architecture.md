# WakeStudio - Architecture

> Status: Accepted (durable overview)
> Scope: High-level architecture of WakeStudio. This document describes *what the
> system is* and *how the pieces fit*, not phase-by-phase status (see
> `.agents/plan/goal.plan` for that). It is kept in sync with `DECISIONS.md` (ADR
> log) and `LICENSES.md` (third-party license matrix).
>
> Companion docs: `docs/module-template.md` (convention for per-module specs),
> `docs/modules/*.md` (written just-in-time at each phase start, per plan §11).

---

## 1. Vision

WakeStudio is a Progressive Web App (PWA) console that takes a developer or product
engineer from "I have a wake word idea" to "I have a deployable, testable KWS bundle
for my target chip" - **without installing any toolchain, runtime, or Python
environment**.

**Core product principle:** _Do not invent new models._ WakeStudio is a
**productization layer** over existing open-source models and DSP components. We
select, integrate, harden, and package - we do not train new foundation models.

WakeStudio wraps the full far-field voice pipeline:

```
AEC ──> BSS ──> NS ──> KWS
```

and makes every stage (1) **trainable/customizable** in the browser where feasible,
(2) **visible** through real-time visualization, and (3) **exportable** to mainstream
embedded and application-processor targets, complete with reference integrations and
runnable demo apps.

---

## 2. The AFE pipeline

The four front-end stages and their standard names (cross-checked against Espressif
ESP-SR, Infineon audio-front-end, and XMOS voice-interface docs):

| Stage | Standard name | Function |
|---|---|---|
| **AEC** | Acoustic Echo Cancellation | Removes loudspeaker/echo feedback from the mic signal. |
| **BSS** | Blind Source Separation | Separates the target source from a mixture without a known mixing model (distinct from beamforming, which steers a fixed/adaptive directional beam). |
| **NS** | Noise Suppression (single-channel) | Spectral post-filter that suppresses stationary/non-stationary background noise. |
| **KWS** | Keyword Spotting / Wake Word Detection | Detects the wake word and raises a trigger. |

> **Scope decision (ADR-001):** the pipeline is strictly **AEC -> BSS -> NS -> KWS** -
> the four named stages only. Dereverberation and AGC are **out of scope for v1**.
>
> BSS is distinct from beamforming. The in-browser live demo uses a 2-mic
> beamforming *approximation* (or passthrough) since true real-time BSS in a browser
> is non-trivial; the real BSS runs device-side via the vendor SDK in exported demos
> (ADR-003).

---

## 3. System architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                      WakeStudio PWA (browser)                    │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐  │
│  │  Capture   │->│  AFE graph │->│  KWS engine│->│  Visualize │  │
│  │ WebAudio + │  │ AEC->BF->NS│  │ ONNX-rt web│  │  + Export  │  │
│  │ AudioWorklet│ │  (WASM)    │  │ + Few-Shot │  │  (Canvas)   │  │
│  └────────────┘  └────────────┘  └────────────┘  └────────────┘  │
│         ^                                 ^                       │
│         │  enroll samples (3–5)          │  train (Phase 5)      │
│         v                                 v                       │
│  ┌──────────────┐               ┌─────────────────────────┐     │
│  │  IndexedDB   │               │  Training backend (1/3) │     │
│  │ (prototypes, │               │  Self-host / Cloud /    │     │
│  │  recordings) │               │  Colab (ADR-023) - see  │     │
│  └──────────────┘               │  §5 (ADR-013/023)       │     │
│                                  └─────────────────────────┘     │
└──────────────────────────────────────────────────────────────────┘
```

**Key design decision - "zero setup" (ADR-005 / ADR-013):**

- The PWA does **all** of the live experience and Few-Shot enrollment **100%
  client-side**. No server. This satisfies the "works out-of-the-box" requirement
  for the primary user journey.
- **Model training runs outside the browser** (ADR-013 amendment): training never
  runs in WASM - it runs on the **Self-hosted Service**, a **Cloud Provider**, or
  **Google Colab** (ADR-023). The browser is retained only for the live experience,
  Few-Shot enrollment (prototype mean-pool + cosine scoring), and inference.
  "Zero setup" holds for the in-browser live/enrollment/export journey; the three
  training backends are *optional* and chosen only when training is needed.

### 3.1 Repository structure — pnpm monorepo (ADR-025)

The repo is a **pnpm workspace monorepo** (方案 A, 2026-07-31). It hosts four
worlds in one tree, each with its own build toolchain, so a module can deliver
web, local-service, device, and train artifacts side by side:

```
wake-studio/                          # pnpm workspace root
├── pnpm-workspace.yaml               # workspace members: apps/*, packages/*
├── package.json                      # orchestration scripts (dev/build/test/fetch:all/train)
├── tsconfig.base.json
├── apps/
│   ├── web/                          # PWA (React + Vite) - the browser console
│   │   ├── src/
│   │   ├── public/                   # model-registry.json, icons (ADR-011 registry)
│   │   └── e2e/                      # L3 browser tests (ADR-026)
│   ├── local-service/                # Node API service (the Self-hosted backend, ADR-005)
│   │   ├── src/
│   │   │   ├── server.ts             # HTTP server (Hono/Fastify)
│   │   │   ├── module-registry.ts    # reads module.spec.json -> mounts module /node routes
│   │   │   ├── train-runner.ts       # spawns module train scripts via uv (ADR-028)
│   │   │   └── artifact-sync.ts      # ADR-027 fetch/verify logic
│   │   └── tests/
│   └── cli/                          # ops CLI (fetch, health, train trigger) - optional
├── packages/
│   ├── contracts/                    # @wake-studio/contracts - pure types + JSON schemas
│   │   └── src/                      # module-spec.ts / kws.ts / afe.ts / train.ts
│   ├── module-kit/                   # @wake-studio/module-kit
│   │   └── src/                      # panel-generator / playground-router / spec-validator / registry
│   ├── test-kit/                     # @wake-studio/test-kit
│   │   └── src/wasm-runner.ts        # L2: load emscripten/onnx artifacts in Node (ADR-026)
│   ├── modules/                      # functional modules (ADR-025) - see §3.2
│   │   └── <category>/<module>/      # e.g. packages/modules/afe/rnnoise/
│   └── sdk/                          # device-side SDK (C/C++, CMake) - ADR-021
│       ├── sdk-base/                 # portable C core
│       └── sdk-esp32/                # platform adapter example
├── device/                           # device world root (C/C++, CMake build tree)
│   ├── CMakeLists.txt
│   ├── sdk-base/                     # portable core
│   └── modules/                      # module device/ dirs, add_subdirectory'd in
├── scripts/                          # root-level ops scripts
├── .github/workflows/
│   ├── ci.yml                        # L1+L2 per module + build apps
│   ├── build-<artifact>.yml          # per-artifact builds (ADR-027)
│   ├── train-<module>.yml            # training workflows (call module train scripts)
│   └── deploy.yml
└── docs/
```

**Cross-world sharing rules (ADR-025):**

- **Contracts live in `packages/contracts`** — web, local-service, and modules
  import *the same type/schema package*; modules depend on contracts, never on
  another module's internals.
- **Per-target exports** — a module package exposes `@wake-studio/module-*/web`,
  `/node`, `/spec`, `/train`, `/device` subpaths; each world imports only what it
  needs (§3.2).
- **module.spec.json is the single shared fact source** — the web panel generator,
  the local-service route registry, and the CI build/train workflows all derive
  from one spec per module.
- **device/** is the C world root and stays separate from the JS world (its own
  CMake build tree); module `device/` directories are pulled in via
  `add_subdirectory`, not npm.

### 3.2 Module layout (ADR-025)

```
packages/modules/<category>/<module>/     # e.g. packages/modules/afe/rnnoise/
├── package.json          # name @wake-studio/module-rnnoise; exports ./web /node /spec /train /device
├── spec/module.spec.json # the single fact source (docs/module-spec.md)
├── core/                 # portable TS: types, DSP, engine facade (web + node share)
├── web/                  # wasm loader + panel config + playground.tsx (browser)
├── node/                 # native/subprocess impl for the local service
├── train/                # train.py + pyproject.toml + requirements (uv, ADR-028)
├── device/               # C/C++ + CMakeLists.txt (into device/ build tree)
└── tests/                # L1 (vitest) / L2 (wasm in Node) / L3 (playwright)
```

---

## 4. Model & component selection

This section defines **what we do NOT invent** and **what we integrate**. Every
entry is an existing, open-source project. Licenses are noted because they directly
affect commercial productization; the authoritative matrix lives in `LICENSES.md`.

> **Core principle:** WakeStudio never redistributes the openWakeWord **pre-trained
> models** (CC BY-NC-SA 4.0) commercially. We train our own models (plan Phase 5)
> so they are commercially ownable. The export license gate (plan Phase 4) enforces
> this.

### 4.1 KWS models - two domains

**Domain A - Low-power / MCU tier (Traditional classification KWS)**

| Component | Source project | License | Role |
|---|---|---|---|
| MCU KWS engine + training | **microWakeWord** (`OHF-Voice/micro-wake-word`) | Apache-2.0 | Train & run small DNN KWS on ESP32-S3-class MCUs via TFLite-Micro. Synthetic-data training. |
| Reference embedding encoder | Google `speech_embedding` (re-implemented in openWakeWord) | Apache-2.0 | Frozen feature backbone shared by the tiny classifier (~1.4M params; MCU-friendly). |
| Melspectrogram frontend | openWakeWord `melspectrogram.onnx` | Apache-2.0 | Standard 16 kHz log-Mel front-end; params match the MCU model. |

**Domain B - High-performance tier (Linux / Android, Few-Shot KWS)**

| Component | Source project | License | Role |
|---|---|---|---|
| Few-Shot encoder (ADR-002) | **PLiX** (`aaqibsaeed/plixkws`, Apache-2.0) | Apache-2.0 | Compact CNN (EfficientNet-v2 "base" / TinyNet-E "small") trained as a Prototypical Network -> 1280-dim embedding; prototype-distance matching. Replaces WavLM-base-plus (too heavy for end-side devices). **Runtime-pluggable:** served via ONNX (onnxruntime-web, default) OR browser-native via `@xenova/transformers` (no ONNX file; zero-Python deployment). See `docs/Technical Reference_ Resource Requirements and Zero-Python Deployment Strategies for WavLM-base-plus and plixkws.md`. |
| Traditional KWS (Linux, optional) | **openWakeWord** (`dscripka/openWakeWord`) | Apache-2.0 (code) | ONNX/TFLite KWS for Linux; also the training pipeline that yields Domain-A-compatible models. ⚠️ Its *pre-trained models* are CC BY-NC-SA (non-commercial). |
| Speaker-verifier (optional false-alarm filter) | openWakeWord `train_custom_verifier` (scikit-learn) | Apache-2.0 | Second-stage filter to cut false alarms for a known user. |
| **PocketSphinx** (lightweight alternative) | `cmusphinx/pocketsphinx` | BSD-style (CMU); bundles WebRTC VAD (BSD-3) | Classic HMM/GMM KWS; viable on MCU-class and above. The lightweight alternative to openWakeWord (ADR-020). |

> **Pluggable KWS backends (ADR-020):** KWS is a `KWSBackend` interface with
> pluggable adapters - openWakeWord (app-class; relatively large), micro-wake-word
> (MCU), PLiX Few-Shot (app-class, enrollment-based), and PocketSphinx
> (lightweight, BSD). The "two domains" above map to backend selection per target,
> not a fixed engine. openWakeWord's pre-trained models remain CC BY-NC-SA
> (demo-only); the export license gate (Phase 4) still blocks them commercially.

### 4.2 AFE components (AEC -> BSS -> NS)

These run both **in the browser** (live in-app experience) and are **exported** as
reference C/C++ pipelines for target chips.

| Stage | Browser runtime | Embedded runtime (export) | License | Source |
|---|---|---|---|---|
| **AEC** | WebRTC AEC3 (WASM) - **deferred to v1.x**; passthrough for v1 (ADR-016) | WebRTC `audio_processing` C++; or SpeexDSP AEC | BSD-3 / BSD | google/webrtc; xiph/speexdsp |
| **BSS** | 2-mic beamforming *approximation* or passthrough | Vendor BSS (ESP-SR BSS) or portable ICA-based BSS | BSD-3 / varies | espressif/esp-sr; WebRTC beamforming fallback |
| **NS** | **RNNoise** (WASM, AudioWorklet) - prebuilt vendored at `src/afe/vendor/rnnoise/` (ADR-016) | RNNoise (C, MCU-portable) or vendor Deep NS | BSD-3 / Apache-2.0 | xiph/rnnoise; port: `@timephy/rnnoise-wasm` (Apache-2.0) |
| VAD (helper) | Silero VAD (ONNX, onnxruntime-web) | Silero VAD (ONNX/TFLite) | MIT | snakers4/silero-vad |

> **AFE export decision (ADR-003):** vendor AFE for the reference demo (vendor-tuned),
> with a portable RNNoise/WebRTC-based AFE as an opt-in alternative for cross-target
> consistency. Two AFE code paths are maintained per target; per-target
> `LICENSES.md` is required because vendor licenses differ.

### 4.3 In-browser inference & training stack

| Concern | Choice | License |
|---|---|---|
| ML inference | **onnxruntime-web** (WebGPU + WASM fallback) - runs in a Web Worker (ADR-018) | Apache-2.0 |
| TFLite/TF models in browser | **@tensorflow/tfjs** (only if a model is TFLite-only) | Apache-2.0 |
| Audio capture/processing | Web Audio API + AudioWorklet | W3C standard |
| TTS for synthetic training data | **Piper** (`OHF-Voice/piper1-gpl` GPL-3.0 active / `rhasspy/piper` MIT archived) | GPL-3.0 / MIT (verify voices) |
| Visualization | Canvas 2D / WebGL (custom, or `regl`-based) | MIT |
| UI (ADR-004) | React 18 + Vite 5 + TypeScript 5 + Tailwind 3 | MIT |

> **Training-data sources (ADR-022):** audio generation and datasets are a
> pluggable, in-app-configurable data-source layer (local services / project APIs /
> public TTS endpoints); generation **never runs in WASM** - it runs in the selected
> training backend or is fetched from configured endpoints. See
> `docs/modules/data-sources.md`.

---

## 5. Model training execution backends (ADR-013)

Model training in WakeStudio is **backend-agnostic**: the PWA presents the same
"train a custom word" flow regardless of where the compute runs. Per the ADR-013
amendment, **training never runs in the browser** - any step that learns weights or
trains a classifier runs on one of three training backends (the browser is retained
only for inference and Few-Shot enrollment). The user picks one; the choice trades
off zero-setup convenience against training capacity and cost.

| # | Backend | Where it runs | Best for | Notes |
|---|---|---|---|---|
| 1 | **Self-hosted Service** | A service the user runs themselves: locally on `localhost` **or deployed on Google Cloud** | Heavy Traditional/MCU training (synthetic data via the data-source layer ADR-022 + openWakeWord/micro-wake-word training) | Evolution of the "Studio Engine" (ADR-005). PyInstaller binary (default) + Docker image. When on Google Cloud, the PWA connects to the user's own endpoint. |
| 2 | **Cloud Providers** (capability-labeled: train-capable vs inference-only) | Managed ML platform of the selected provider | Users who want turnkey managed training without running any service | Providers: **AWS, Google Cloud, Hugging Face, Alibaba Cloud, Tencent Cloud, Volcengine**. User selects a provider and enters its credentials; WakeStudio **automatically executes training, monitors training status, and exports training artifacts** within that service. |
| 3 | **Google Colab** (ADR-023) | The user's own Colab session (their Google account / Drive) | Users who want GPU compute + notebooks with no local install and no provider credentials | WakeStudio provides IPython notebooks; the user runs them in Colab and **exports results** (`.onnx`/`.tflite` + metadata, generated audio) back to the PWA. No WakeStudio server. |

> **In-Browser (WASM)** is **not** a training backend (ADR-013 amendment). It
> remains the execution surface for client-side **inference and Few-Shot
> enrollment** (prototype mean-pooling + cosine scoring) - enrollment/inference,
> not training.

> **Self-hosted engine candidate (Q10, open):** [`TigreGotico/wakeforge`](https://github.com/TigreGotico/wakeforge)
> (Python package `ww_trainer`, Apache-2.0, NLnet/NGI0-funded) is a research-grade,
> ONNX-first "phrase -> ONNX" wake-word training suite and a strong candidate for
> the Self-hosted Service backend - potentially replacing a direct wrap of the
> openWakeWord training pipeline. It is **complementary, not duplicative**: training
> layer only; none of WakeStudio's AFE / live in-browser experience / Few-Shot
> enrollment / per-chip export kits. Evaluate in Phase 5 (see plan Q10).

**Cloud-provider credential flow:**

1. User opens "Train a custom word" and sets **Backend = Cloud Provider**.
2. User selects a provider (AWS / Google Cloud / Hugging Face / Alibaba Cloud /
   Tencent Cloud / Volcengine).
3. The UI presents a provider-specific credential form (e.g. AWS access key + secret
   + region; Google Cloud service-account JSON + project; Hugging Face token;
   Alibaba Cloud AccessKey ID/Secret + region; Tencent Cloud SecretId/SecretKey +
   region; Volcengine AccessKey ID/Secret + region).
4. Credentials are held **client-side only** (in memory / IndexedDB; never sent to
   any WakeStudio server) and are used solely to drive the provider's training API.
5. WakeStudio submits the training job, polls/streams training status back into the
   PWA, and retrieves the resulting model artifacts (`.onnx` / `.tflite` + metadata)
   for in-browser testing and export.

> **Security note:** Cloud-provider credentials are secrets. They must never be
> logged, persisted to a remote service, or bundled into exported artifacts. The
> Cloud backend is an *optional* capability; the In-Browser (inference/enrollment),
> Self-hosted, and Colab backends require no third-party credentials at all. See
> plan §5.1 and §9 (risks).

---

## 6. Target platforms & export matrix

Export is a client-side operation: the PWA generates a downloadable `.zip`
(JSZip) per target - no server needed. Per ADR-021, **every export is built on the
device-side SDK**: each bundle is an SDK-based project (model + AFE config + SDK
adapter + `demo/` + `README.md` + `LICENSES.md` + `test/` FAR/FRR). A **license
gate** refuses to export a non-commercial-licensed model into a "commercial"
package and offers to train a clean replacement instead.

| Target | Tier | KWS backend(s) (ADR-020) | AFE | Model format | SDK binding (ADR-021) |
|---|---|---|---|---|---|
| **Arm Cortex-M** (STM32, Arduino) | MCU (primary) | micro-wake-word (TFLite-Micro); PocketSphinx (alt) | Portable RNNoise + WebRTC | `.tflite` / C | C / TFLite-Micro |
| **Raspberry Pi** (Zero, 3, 4, 5) | App-class edge | openWakeWord / PLiX Few-Shot / PocketSphinx | RNNoise + WebRTC | `.onnx` | Python |
| **Android** | Mobile | openWakeWord / PLiX Few-Shot (ONNX RT Android) | RNNoise + WebRTC | `.onnx` | Kotlin |
| **iOS** | Mobile | openWakeWord / PLiX Few-Shot (ONNX RT / Core ML) | RNNoise + WebRTC | `.onnx` / Core ML | Swift |
| **Browsers** (Chrome, Safari, Firefox, Edge) | Browser | openWakeWord / PLiX Few-Shot (onnxruntime-web) | RNNoise (WASM) | `.onnx` | JS / WASM |
| **Linux** (x86_64) | Desktop | openWakeWord / PLiX Few-Shot / PocketSphinx | RNNoise + WebRTC | `.onnx` | Python |
| **macOS** (x86_64, arm64) | Desktop | openWakeWord / PLiX Few-Shot (ONNX RT / Core ML on arm64) | RNNoise + WebRTC | `.onnx` / Core ML | Python / Swift |
| **Windows** (x86_64, arm64) | Desktop | openWakeWord / PLiX Few-Shot (ONNX RT) | RNNoise + WebRTC | `.onnx` | Python |
| **ESP32-S3** (deferred) | MCU (extended) | micro-wake-word (TFLite-Micro) | ESP-SR (AEC/NS/BSS) | `.tflite` + C array | C / TFLite-Micro |

> **Target matrix (ADR-019, supersedes ADR-006):** the full cross-device set is
> validated, with **Arm Cortex-M (STM32, Arduino)** as the primary MCU tier.
> **ESP32-S3** is a deferred extended target (Xtensa, not Cortex-M). Each target is
> an **SDK adapter** (ADR-021), not a one-off codepath. The in-browser PWA demo
> uses the same `KWSBackend` interface (ADR-020) via the JS/WASM binding.

---

## 7. Cross-cutting concerns

- **License policy (ADR-009 / ADR-011).** WakeStudio source is MIT. Models are
  fetched lazily from a `model-registry.json` catalog (URL, checksum, license, tier,
  commercial-use flag) - never bundled. The openWakeWord pre-trained models (CC
  BY-NC-SA) never enter a commercial export; the gate enforces it. See
  `LICENSES.md` for the authoritative matrix.
- **Offline / PWA.** `vite-plugin-pwa` provides an installable, offline-capable
  shell. After first load, runtime assets (models, WASM) are cached via the service
  worker so the app is fully usable with no network. **Pre-fetch (ADR-011
  amendment):** assets (WASM, ONNX, …) can be bulk-downloaded ahead of time and
  integrity-checked against the registry; if a download fails, the agent asks the
  human rather than retrying blindly.
- **Security.** Mic permissions, CSP, the localhost self-hosted-service protocol,
  and cloud-provider credential handling are reviewed before release. Credentials
  are client-side only and never logged or exported.
- **Runtime feature detection.** WebGPU/WASM-SIMD support varies; the app
  feature-detects and falls back to WASM, surfacing a "performance" indicator.
- **Per-component config panel (ADR-017).** The Studio renders a parameter panel
  with defaults for every component (AFE, KWS, Few-Shot, Export, Training). Each
  module exposes its tunables via a shared `describeParameters()` descriptor; the
  UI renders controls generically and persists user values. Built incrementally -
  the AFE panel lands in Phase 1, each later phase adds its component's panel.
- **Device-side SDK (ADR-021).** A layered portable SDK (C core + target adapters
  + language bindings) underpins every export (Phase 4); the in-browser demo
  consumes the same `KWSBackend` interface (ADR-020). See `docs/modules/sdk.md`.
- **Training-data sources (ADR-022).** Audio generation and datasets are a
  pluggable, in-app-configurable data-source layer (local services / project APIs /
  public TTS endpoints); generation never runs in WASM. See
  `docs/modules/data-sources.md`.
- **Deploy (ADR-012).** `VITE_BASE_PATH` configures the base path - `/` for
  Cloudflare Pages, `/<repo-name>/` for GitHub Pages project sites.
- **CI/CD (ADR-015).** Workflow files (`ci.yml`, `deploy.yml`) are scaffolded but
  **dormant** until post-MVP: deploy is manual (`workflow_dispatch`), and CI runs
  only on push/PR to the remote (not yet in use). Local
  `pnpm lint`/`typecheck`/`build`/`test:e2e` is the source of truth during the
  MVP build; activation (Pages/Cloudflare secrets, workflow review, first deploy)
  happens in Phase 6.

---

## 8. Related decisions & docs

- **ADR log:** `DECISIONS.md` - notably ADR-001 (pipeline stages), ADR-002 (PLiX Few-Shot
  encoder), ADR-003 (vendor vs portable AFE), ADR-004 (React+Vite+TS), ADR-005
  (self-hosted service packaging), ADR-006 (first targets), ADR-009 (MIT license),
  ADR-011 (lazy model registry), ADR-012 (deploy base path), ADR-013 (training
  backends), ADR-014 (project name "WakeStudio"), ADR-015 (CI/CD deferred to
  post-MVP), ADR-016 (AFE Phase 1 design), ADR-017 (per-component config panel),
  ADR-018 (KWS Phase 2 design), ADR-019 (target matrix, supersedes ADR-006),
  ADR-020 (pluggable KWS backends), ADR-021 (device-side SDK), ADR-022 (data-source
  layer), ADR-023 (Colab backend), ADR-024 (3-category KWS taxonomy + decoupling
  rule + unified panel spec), ADR-025 (module platform + monorepo), ADR-026
  (testing layers), ADR-027 (build-artifact SOP), ADR-028 (uv for train scripts);
  ADR-013 amended (in-browser training removed, Cloud Providers unified, Colab
  added) and ADR-011 amended (asset pre-fetch).
- **License matrix:** `LICENSES.md`.
- **Living plan & phased roadmap:** `.agents/plan/goal.plan` (gitignored; the source
  of truth for phase status and open questions).
- **Per-module specs:** `docs/modules/*.md`, each written just-in-time at its
  phase's start using `docs/module-template.md` (see plan §11).
- **KWS categories spec:** `docs/kws-categories.md` — the 3-category taxonomy
  (Traditional / ASR-Decoding / Few-Shot), the decoupling rule, the dual-layer
  unified panel spec, and the P0 integration TODO (ADR-024).
- **Pre-research:** `docs/Technical Pre-Research & Feasibility Study_ On-Device
  Wake Word Detection Systems.md`.
