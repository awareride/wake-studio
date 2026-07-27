# WaveStudio - Architecture

> Status: Accepted (durable overview)
> Scope: High-level architecture of WaveStudio. This document describes *what the
> system is* and *how the pieces fit*, not phase-by-phase status (see
> `.agents/plan/goal.plan` for that). It is kept in sync with `DECISIONS.md` (ADR
> log) and `LICENSES.md` (third-party license matrix).
>
> Companion docs: `docs/module-template.md` (convention for per-module specs),
> `docs/modules/*.md` (written just-in-time at each phase start, per plan §11).

---

## 1. Vision

WaveStudio is a Progressive Web App (PWA) console that takes a developer or product
engineer from "I have a wake word idea" to "I have a deployable, testable KWS bundle
for my target chip" - **without installing any toolchain, runtime, or Python
environment**.

**Core product principle:** _Do not invent new models._ WaveStudio is a
**productization layer** over existing open-source models and DSP components. We
select, integrate, harden, and package - we do not train new foundation models.

WaveStudio wraps the full far-field voice pipeline:

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
│                      WaveStudio PWA (browser)                    │
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
│  │ (prototypes, │               │  In-Browser / Self-host │     │
│  │  recordings) │               │  / Cloud provider - see │     │
│  └──────────────┘               │  §5.1 (AWS/GCP/HF/...)  │     │
│                                  └─────────────────────────┘     │
└──────────────────────────────────────────────────────────────────┘
```

**Key design decision - "zero setup" (ADR-005 / ADR-013):**

- The PWA does **all** of the live experience and Few-Shot enrollment **100%
  client-side**. No server. This satisfies the "works out-of-the-box" requirement
  for the primary user journey.
- **Model training offers three execution backends** (see §5), chosen by the user:
  **In-Browser (WASM)** keeps light training fully client-side; the **Self-hosted
  Service** and **Cloud Training Providers** cover heavy Traditional/MCU training
  (synthetic-data generation + PyTorch classifier training) without shipping Python
  into the browser. "Zero setup" holds for the In-Browser path and the primary
  live/enrollment/export journey; the other two backends are *optional*.

---

## 4. Model & component selection

This section defines **what we do NOT invent** and **what we integrate**. Every
entry is an existing, open-source project. Licenses are noted because they directly
affect commercial productization; the authoritative matrix lives in `LICENSES.md`.

> **Core principle:** WaveStudio never redistributes the openWakeWord **pre-trained
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
| Few-Shot encoder (ADR-002) | **WavLM** (`microsoft/wavlm-base-plus`) | MIT | Frozen universal speech encoder -> embedding; cosine-similarity prototype matching. ~95M params; int8 ~95 MB. |
| Traditional KWS (Linux, optional) | **openWakeWord** (`dscripka/openWakeWord`) | Apache-2.0 (code) | ONNX/TFLite KWS for Linux; also the training pipeline that yields Domain-A-compatible models. ⚠️ Its *pre-trained models* are CC BY-NC-SA (non-commercial). |
| Speaker-verifier (optional false-alarm filter) | openWakeWord `train_custom_verifier` (scikit-learn) | Apache-2.0 | Second-stage filter to cut false alarms for a known user. |

### 4.2 AFE components (AEC -> BSS -> NS)

These run both **in the browser** (live in-app experience) and are **exported** as
reference C/C++ pipelines for target chips.

| Stage | Browser runtime | Embedded runtime (export) | License | Source |
|---|---|---|---|---|
| **AEC** | WebRTC AEC3 (WASM) | WebRTC `audio_processing` C++; or SpeexDSP AEC | BSD-3 / BSD | google/webrtc; xiph/speexdsp |
| **BSS** | 2-mic beamforming *approximation* or passthrough | Vendor BSS (ESP-SR BSS) or portable ICA-based BSS | BSD-3 / varies | espressif/esp-sr; WebRTC beamforming fallback |
| **NS** | **RNNoise** (WASM, AudioWorklet) | RNNoise (C, MCU-portable) or vendor Deep NS | BSD-3 | xiph/rnnoise; WASM ports: `@timephy/rnnoise-wasm` (Apache-2.0), `simple-rnnoise-wasm` (MIT) |
| VAD (helper) | Silero VAD (ONNX, onnxruntime-web) | Silero VAD (ONNX/TFLite) | MIT | snakers4/silero-vad |

> **AFE export decision (ADR-003):** vendor AFE for the reference demo (vendor-tuned),
> with a portable RNNoise/WebRTC-based AFE as an opt-in alternative for cross-target
> consistency. Two AFE code paths are maintained per target; per-target
> `LICENSES.md` is required because vendor licenses differ.

### 4.3 In-browser inference & training stack

| Concern | Choice | License |
|---|---|---|
| ML inference | **onnxruntime-web** (WASM + WebGPU) | Apache-2.0 |
| TFLite/TF models in browser | **@tensorflow/tfjs** (only if a model is TFLite-only) | Apache-2.0 |
| Audio capture/processing | Web Audio API + AudioWorklet | W3C standard |
| TTS for synthetic training data | **Piper** (`OHF-Voice/piper1-gpl` GPL-3.0 active / `rhasspy/piper` MIT archived) | GPL-3.0 / MIT (verify voices) |
| Visualization | Canvas 2D / WebGL (custom, or `regl`-based) | MIT |
| UI (ADR-004) | React 18 + Vite 5 + TypeScript 5 + Tailwind 3 | MIT |

---

## 5. Model training execution backends (ADR-013)

Model training in WaveStudio is **backend-agnostic**: the PWA presents the same
"train a custom word" flow regardless of where the compute runs. The user picks one
of three execution backends; the choice trades off zero-setup convenience against
training capacity and cost.

| # | Backend | Where it runs | Best for | Notes |
|---|---|---|---|---|
| 1 | **In-Browser (WASM)** | 100% client-side, same PWA | Light jobs: Few-Shot prototype computation and any future browser-feasible training | Truest to "zero setup". Limited by browser memory/CPU; **not** suitable for synthetic-data generation + full PyTorch classifier training. |
| 2 | **Self-hosted Service** | A service the user runs themselves: locally on `localhost` **or deployed on Google Cloud** | Heavy Traditional/MCU training (Piper TTS synthetic data + openWakeWord/microWakeWord training) | Evolution of the "Studio Engine" (ADR-005). PyInstaller binary (default) + Docker image. When on Google Cloud, the PWA connects to the user's own hosted endpoint. |
| 3 | **Cloud Training Provider** | Managed ML platform of the selected provider | Users who want turnkey managed training without running any service | Providers: **AWS, Google Cloud, Hugging Face, Alibaba Cloud, Tencent Cloud, Volcengine**. User selects a provider and enters its credentials; WaveStudio **automatically executes training, monitors training status, and exports training artifacts** within that service. |

**Cloud-provider credential flow:**

1. User opens "Train a custom word" and sets **Backend = Cloud Provider**.
2. User selects a provider (AWS / Google Cloud / Hugging Face / Alibaba Cloud /
   Tencent Cloud / Volcengine).
3. The UI presents a provider-specific credential form (e.g. AWS access key + secret
   + region; Google Cloud service-account JSON + project; Hugging Face token;
   Alibaba Cloud AccessKey ID/Secret + region; Tencent Cloud SecretId/SecretKey +
   region; Volcengine AccessKey ID/Secret + region).
4. Credentials are held **client-side only** (in memory / IndexedDB; never sent to
   any WaveStudio server) and are used solely to drive the provider's training API.
5. WaveStudio submits the training job, polls/streams training status back into the
   PWA, and retrieves the resulting model artifacts (`.onnx` / `.tflite` + metadata)
   for in-browser testing and export.

> **Security note:** Cloud-provider credentials are secrets. They must never be
> logged, persisted to a remote service, or bundled into exported artifacts. The
> Cloud backend is an *optional* capability; the In-Browser and Self-hosted backends
> require no third-party credentials at all. See plan §5.1 and §9 (risks).

---

## 6. Target platforms & export matrix

Export is a client-side operation: the PWA generates a downloadable `.zip`
(JSZip) per target - no server needed. Each bundle contains the model, AFE config,
`README.md`, a `demo/` app, a `LICENSES.md` for the bundle, and a `test/` FAR/FRR
script. A **license gate** refuses to export a non-commercial-licensed model into a
"commercial" package and offers to train a clean replacement instead.

| Target | Domain | KWS runtime | AFE runtime | Model format | Integration ref |
|---|---|---|---|---|---|
| **ESP32-S3** | Low-power | TFLite-Micro (microWakeWord) | ESP-SR (AEC/NS/BSS) | `.tflite` + C array | ESP-IDF example app |
| **STM32 (H7)** | Low-power | TFLite-Micro / X-CUBE-AI | Portable RNNoise + WebRTC AEC | `.tflite` / C | STM32CubeIDE example |
| **TI (C2000/AM62x)** | Low-power / App | TFLite-Micro / ONNX RT | TI TIDL / vendor AFE | `.tflite` / ONNX | TI example |
| **Linux (Pi/RK3568)** | High-perf | openWakeWord (ONNX RT) / Few-Shot WavLM | RNNoise + WebRTC | `.onnx` | Python + C++ demo |
| **Android** | High-perf | ONNX Runtime Android / Few-Shot | RNNoise + WebRTC | `.onnx` | Kotlin demo app |

> **First-target priority (ADR-006):** ESP32-S3 (Domain A) and Linux/Raspberry Pi
> (Domain B) are the "golden path" - the first two targets validated on hardware.

---

## 7. Cross-cutting concerns

- **License policy (ADR-009 / ADR-011).** WaveStudio source is MIT. Models are
  fetched lazily from a `model-registry.json` catalog (URL, checksum, license, tier,
  commercial-use flag) - never bundled. The openWakeWord pre-trained models (CC
  BY-NC-SA) never enter a commercial export; the gate enforces it. See
  `LICENSES.md` for the authoritative matrix.
- **Offline / PWA.** `vite-plugin-pwa` provides an installable, offline-capable
  shell. After first load, runtime assets (models, WASM) are cached via the service
  worker so the app is fully usable with no network.
- **Security.** Mic permissions, CSP, the localhost self-hosted-service protocol,
  and cloud-provider credential handling are reviewed before release. Credentials
  are client-side only and never logged or exported.
- **Runtime feature detection.** WebGPU/WASM-SIMD support varies; the app
  feature-detects and falls back to WASM, surfacing a "performance" indicator.
- **Deploy (ADR-012).** `VITE_BASE_PATH` configures the base path - `/` for
  Cloudflare Pages, `/<repo-name>/` for GitHub Pages project sites.

---

## 8. Related decisions & docs

- **ADR log:** `DECISIONS.md` - notably ADR-001 (pipeline stages), ADR-002 (WavLM
  encoder), ADR-003 (vendor vs portable AFE), ADR-004 (React+Vite+TS), ADR-005
  (self-hosted service packaging), ADR-006 (first targets), ADR-009 (MIT license),
  ADR-011 (lazy model registry), ADR-012 (deploy base path), ADR-013 (training
  backends).
- **License matrix:** `LICENSES.md`.
- **Living plan & phased roadmap:** `.agents/plan/goal.plan` (gitignored; the source
  of truth for phase status and open questions).
- **Per-module specs:** `docs/modules/*.md`, each written just-in-time at its
  phase's start using `docs/module-template.md` (see plan §11).
- **Pre-research:** `docs/Technical Pre-Research & Feasibility Study_ On-Device
  Wake Word Detection Systems.md`.
