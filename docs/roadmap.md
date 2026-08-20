# WakeStudio — Product Roadmap

> Durable, versioned roadmap (replaces the former `.agents/plan/goal.plan`,
> which was gitignored and is retired). **Live work state lives in GitHub**
> (Issues + the `WakeStudio Delivery` project, org `awareride`) — this doc
> keeps the static vision, phase history, and pointers; it never holds live
> status.
> Owner: WakeStudio team · Updated: 2026-08-20 (Phase 4 SDK core + app-class device drivers shipped)
> Companions: `docs/architecture.md` (durable architecture), `DECISIONS.md`
> (ADR log), `LICENSES.md` (license matrix), `docs/modules/*.md` (module
> specs), `CONTRIBUTING.md` (working agreements + issue/project model).

---

## 1. Vision

Build **WakeStudio**, a Progressive Web App (PWA) console that lets a developer
or product engineer go from "I have a wake word idea" to "I have a deployable,
testable KWS bundle for my target chip" — **without installing any toolchain,
runtime, or Python environment**.

WakeStudio wraps the full voice pipeline:

```
AEC ──> BSS ──> NS ──> KWS
```

and makes every stage (1) **trainable/customizable** (in the browser where
feasible, otherwise via a training backend), (2) **visible** through real-time
visualization, and (3) **exportable** to mainstream embedded and
application-processor targets, complete with reference integrations and runnable
demo apps.

**Core product principle:** _Do not invent new models._ WakeStudio is a
**productization layer** over excellent open-source models and DSP components.
We select, integrate, harden, and package — we do not train new foundation
models.

**Two domains** (see README): low-power (MCU) vs high-performance
(Linux/Android), served by two KWS tracks with different open-source stacks.

## 2. Requirements

| # | Requirement | How the plan addresses it |
|---|---|---|
| R1 | Full-chain AFE: AEC -> BSS -> NS -> KWS | Browser audio graph runs the whole chain; each stage is a pluggable module (ADR-025). AEC is passthrough for v1 (ADR-016). |
| R2 | Works out-of-the-box, no environment setup | PWA console running the live experience client-side (WebAudio + WASM + onnxruntime-web). Training runs on one of three backends, not in the browser (ADR-013). |
| R3 | Users upload a few wake-word samples to train a new model | Few-Shot enrollment (3–5 samples, PLiX encoder, prototype-distance) is fully client-side (Phase 3, ADR-002). |
| R4 | Model export for the full cross-device matrix + integration refs + testable demos | Phase 4 export kits built on the device-side SDK (ADR-021); every bundle ships a runnable demo (ADR-019). |
| R5 | In-app experience with visual outputs across the pipeline | Phases 1–2 deliver real-time visualizations per stage; the Workspace pipeline canvas orchestrates them. |
| R6 | Two domains: Low-power (MCU) vs High-performance (Linux/Android) | Two KWS tracks with different open-source stacks, selected per target via pluggable `KWSBackend` (ADR-020). |
| R7 | High-performance supports user-defined wake words via Few-Shot KWS | Few-Shot track (Phase 3) — shipped. |
| R8 | Low-power and high-performance use different KWS solutions | MCU = Traditional (classification) KWS (micro-wake-word); App-class = Few-Shot (metric-learning, PLiX) (ADR-020). |

## 3. Architecture & module platform

The durable architecture lives in `docs/architecture.md`; the ADR log in
`DECISIONS.md` (ADR-001…). Key invariants:

- **Pipeline** is strictly **AEC → BSS → NS → KWS** (ADR-001); AEC/BSS are
  passthrough for v1 (ADR-016), NS is RNNoise (vendored WASM), KWS is pluggable.
- **Monorepo** (ADR-025): `apps/web` (PWA), `apps/studio-backend` (Python,
  self-hosted training service, ADR-005/036), `packages/contracts` (shared types/schemas),
  `packages/module-kit` (spec-driven panel generator), `packages/test-kit`
  (L2 wasm runner), `packages/platform` (base-path, registry, runtime seams),
  `packages/modules/*` (functional modules), `packages/sdk` (device SDK),
  top-level `device/` (C/C++ CMake tree). A module owns core + spec +
  generated panel + tests + playground + multi-target deliverables;
  `module.spec.json` is the single shared fact source.
- **Module migration (ADR-025/029/030/031) is complete** — every functional
  area is a self-contained module (AFE stages + graph, KWS engine + drivers,
  Few-Shot, Training); panels are generated, never hand-written; assets are
  module-owned (ADR-025/027).
- **Training runs on three backends** (ADR-013 amended): Self-hosted Service,
  Cloud Providers (capability-labeled), Google Colab (ADR-023). In-Browser
  WASM is inference/Few-Shot enrollment only.
- **KWS** is organized into three categories (ADR-024): Traditional, ASR
  Decoding, Few-Shot — with a hard decoupling rule (a new category = a driver
  module + a panel, no shared-module edits). Newer: provisioning capabilities
  (ADR-033) and composition roots (ADR-034) — drivers self-register; the host
  dispatches on capabilities, never per-driver code.
- **Exports** are client-side `.zip` bundles built on the layered device-side
  SDK (ADR-021); a license gate blocks non-commercial models (ADR-009/011).
- **Testing** is three-layer (ADR-026): L1 unit, L2 wasm/onnx boot (Node,
  every PR), L3 browser e2e (merge gate). All KWS drivers have L2 suites that
  run for real in CI (sherpa/openwakeword/plix; assets are GitHub Release
  hosted, ADR-027 §6.7). The device SDK adds native host build + unit tests on
  every PR (ADR-040 §5; slices #182/#183/#186).
- **Deploy** (ADR-012): `VITE_BASE_PATH` — `/` for Cloudflare, `/<repo>/` for
  GitHub Pages.

## 4. Model & component selection

> The authoritative matrix is `LICENSES.md`; the KWS taxonomy is
> `docs/kws-categories.md`. Key fact: **openWakeWord's pre-trained models are
> CC BY-NC-SA 4.0 (demo-only)** — they must never enter a commercial bundle;
> the Phase 4 export license gate enforces this.

| Backend | Category (ADR-024) | License | Tier / targets | In repo today |
|---|---|---|---|---|
| **openWakeWord** (`dscripka/openWakeWord`) | Traditional | Apache-2.0 code; CC BY-NC-SA pre-trained models (demo-only) | App-class (Pi, desktop, mobile, browser) | ✅ browser + ✅ device driver (`kws/openwakeword/device/`, #192) |
| **sherpa-onnx KWS** (`k2-fsa/sherpa-onnx`) | ASR Decoding | Apache-2.0 | App-class + MCU; real KWS transducer, compiled WASM in-browser | ✅ browser + ✅ device driver (`kws/sherpa/device/`, #193) |
| **PLiX Few-Shot** (`aaqibsaeed/plixkws`) | Few-Shot | Apache-2.0 | App-class, enrollment-based (prototype-distance, ADR-002); onnx + transformers runtimes | ✅ `packages/modules/kws/plix/` |
| **micro-wake-word** (`OHF-Voice/micro-wake-word`) | Traditional | Apache-2.0 | MCU (Cortex-M, ESP32) via TFLite-Micro | ⏳ Phase 4/5 |
| **PocketSphinx** (`cmusphinx/pocketsphinx`) | Traditional (lightweight alt) | BSD-style | MCU-class and above, lightweight alternative | ⏳ Deferred to v1.x (ADR-043) |

AFE components (ADR-016): AEC = passthrough for v1 (WebRTC/SpeexDSP in
exports); BSS = passthrough or 2-mic approximation (vendor BSS in exports);
NS = **RNNoise** (vendored WASM, AudioWorklet); VAD = RNNoise VAD score
(Silero deferred to v1.x). Inference = onnxruntime-web (WebGPU + WASM fallback)
in a Web Worker; TTS/synthetic data = Piper, runs in training backends, not the
browser (ADR-022). UI = React 18 + Vite 5 + TS 5 + Tailwind 3 + Radix.

## 5. Target platforms & export matrix (ADR-019)

Export is client-side `.zip` generation (JSZip) built on the device-side SDK
(ADR-021); the license gate blocks non-commercial models.

| Target | Tier | KWS backend(s) | SDK binding | Status |
|---|---|---|---|---|
| **Arm Cortex-M** (STM32, Arduino) | MCU (primary) | micro-wake-word; PocketSphinx (alt) | C / TFLite-Micro | ⏳ Phase 4 |
| **Raspberry Pi** (Zero/3/4/5) | App-class edge | openWakeWord / PLiX / PocketSphinx | Python | ⏳ Phase 4 |
| **Android** | Mobile | openWakeWord / PLiX (ONNX RT) | Kotlin | ⏳ Phase 4 |
| **iOS** | Mobile | openWakeWord / PLiX (ONNX RT / Core ML) | Swift | ⏳ Phase 4 |
| **Browsers** (Chrome/Safari/Firefox/Edge) | Browser | openWakeWord / PLiX (onnxruntime-web) | JS / WASM | ✅ (in-app demo) |
| **Linux** (x86_64) | Desktop | openWakeWord / PLiX / PocketSphinx | Python | ⏳ Phase 4 |
| **macOS** / **Windows** | Desktop | openWakeWord / PLiX | Python / Swift | ⏳ Phase 4 |
| **ESP32-S3** (deferred) | MCU (extended) | micro-wake-word | C / TFLite-Micro | ⏳ Deferred |

## 6. Phased roadmap

Each phase is independently validatable and follows the **docs-first** rule:
the relevant module doc (`docs/modules/*.md`) is written/reviewed before the
module is implemented, and updated in the same change as the code (docs-sync
rule, `CONTRIBUTING.md`).

### Phase 0 — Foundation, decisions & scaffold — ✅ Complete

ADR-001…012 recorded; pnpm workspace + PWA shell (Vite 5 + React 18 + TS 5 +
Tailwind 3 + `vite-plugin-pwa`); model-registry manifest + lazy loader; CI +
deploy workflow scaffolds (dormant, ADR-015); docs-first baseline.

### Phase 1 — In-browser AFE + pipeline visualization — ✅ Complete

RNNoise NS (vendored WASM, ADR-016), AudioWorklet pipeline, per-stage bypass,
latency meter, Record/Replay, config panel from `describeParameters()`
(ADR-017). AEC/BSS passthrough for v1 (ADR-016).

### Phase 2 — KWS inference in the browser — ✅ Complete

`KWSBackend` interface (ADR-020); **openWakeWord** backend (mel/embed/
classifier in a Web Worker, ADR-018); **sherpa-onnx-kws** backend (real KWS
transducer via compiled WASM, ADR-024 ASR-Decoding); score curve,
threshold/min-duration smoothing, trigger flash, VAD gating (ADR-018).

### Phase 3 — Few-Shot custom wake-word enrollment — ✅ Complete

PLiX encoder (ADR-002) + prototype-distance scoring (client-side), sample
recording with quality checks, IndexedDB persistence, enrollment UI,
anti-false-trigger measures, Few-Shot bundle export.

### Phase 3.5 — Console / Studio productization — ✅ Complete

App shell (Radix), hash routing, status bar; Workspace + project model
(IndexedDB) + pipeline canvas + unified spec-driven config panels; Model
Library + export license gate; Session console + trigger history; base-path
awareness (ADR-012); module platform (ADR-025).

### Phase 3.6 — Module platform migration (ADR-025/029/030/031) — ✅ Complete

All functional areas moved from `apps/web/src/{afe,kws,few-shot}` into
self-contained modules with specs + generated panels: `packages/platform`,
per-stage AFE modules, KWS engine + per-backend drivers (self-registration,
ADR-030), Few-Shot, Training (contract + spec panel, ADR-031). Follow-ups:
KWSPanel registration seams (ADR-034), provisioning capability (ADR-033),
kws-streaming module.

### Phase 3.7 — KWS Phase-3 closure — ✅ Complete (2026-08-11)

Every KWS backend loads in the browser and is guarded by tests that run for
real on every PR (PRs #82/#84/#85/#86):

- L2 boot suites for all drivers: **sherpa** (the browser emscripten bundle
  boots in a Node vm — #49), **openwakeword** (mel → embedding → classifier),
  **plix** (1280-dim embed, #48).
- Asset pipeline (ADR-027 §6.7): the wasm/onnx assets are hosted as GitHub
  Releases (`models-sherpa-wasm-v1`, `models-openwakeword-v1`,
  `models-plix-v1`) and fetched in CI — the L2/e2e suites execute instead of
  skipping; `scripts/fetch-artifact.mjs` gained a release-download mode.
- e2e per backend (sherpa/openwakeword/plix onnx + transformers) + stale
  assertions from the panel rewrite fixed.

### Phase 4 — Device-side SDK & export kits (ADR-021) — 🔄 In progress

> Tracked as epic [#31](https://github.com/awareride/wake-studio/issues/31)
> (In Progress) with sub-issues #37–#42 and implementation slices #179–#189
> in the `WakeStudio Delivery` project.
> Docs-first: `docs/modules/sdk.md` (Draft v2, landed with ADR-040) +
> `docs/modules/export.md` (still to write before bundle generation).
> Status (2026-08-20): SDK core shipped (ADR-040, slices #179–#184 closed,
> PR #191); app-class device drivers shipped for openwakeword (#192),
> kws-streaming (#194) and sherpa (#193) (PRs #196/#197/#198); Cortex-M
> cross-compile CI landed (#186). Remaining: microwakeword driver (#185),
> Pi Python binding (#187), plix driver (#188), bundle generator (#189),
> license gate (#42).

1. **SDK core (C/C++, `packages/sdk` + `device/`):** portable core
   (`KWSBackend` interface ADR-020, portable AFE ADR-003/016, audio I/O +
   threading + clock abstractions, VAD); CMake tree in `device/` (ADR-025).
   Validate with one C unit-test harness first.
2. **Target adapters:** first two golden paths — **Cortex-M** (STM32/Arduino,
   micro-wake-word + TFLite-Micro) and **Raspberry Pi** (PLiX/openWakeWord +
   Python); then Android (Kotlin), iOS (Swift), desktop (Python), browsers
   (JS/WASM).
3. **Language bindings** per target (ADR-021 §3).
4. **Bundle generation:** client-side `.zip` per target (model + AFE config +
   SDK adapter + demo + README + LICENSES + test); each bundle runs a demo.
5. **License gate:** block CC BY-NC-SA models from commercial exports; offer
   to train a clean replacement (Phase 5).
6. **PocketSphinx** backend as the lightweight Traditional alternative
   (ADR-020) — **deferred to v1.x** (ADR-043, Q12 #34 resolved): micro-wake-word
   + sherpa cover its niche; revisit only if micro-wake-word proves
   insufficient on the MCU tier.

Validation: Cortex-M bundle builds on real hardware and triggers on the wake
word; Pi bundle runs and triggers; bundle README lists every included license;
the gate blocks a non-commercial model from a commercial export.

### Phase 5 — Custom-model training (multi-backend) — ⏳ Pending

> Docs-first: `docs/modules/training.md` + `docs/modules/data-sources.md`
> (stubs exist; the train integration contract is locked — ADR-013/023/028).
> Training never runs in the browser (ADR-013 amendment).

1. **Common training-job interface** (ADR-013): one PWA flow — type the wake
   phrase, choose target, choose backend, monitor status, retrieve artifacts
   into the app for in-browser test + export.
2. **Self-hosted Service** (`apps/studio-backend`, ADR-005/036): real training
   runner (Python/FastAPI job manager; `uv run wake-service` spawns module
   `train/` scripts via `uv`, ADR-028); PyInstaller binary + Docker image;
   engine = the module-owned openWakeWord pipeline (ADR-042; wakeforge is
   a documented optional future eval, not integrated).
3. **Cloud Providers** (capability-labeled): AWS / Google Cloud / Hugging
   Face / Alibaba / Tencent / Volcengine adapters behind the common interface;
   credentials client-side only.
4. **Google Colab** (ADR-023): version-controlled notebooks (`colab/`);
   standard result bundle convention (shared artifact-bundle manifest).
5. **Data-source layer** (ADR-022): in-app endpoint config for local
   services / project APIs / public TTS endpoints.
6. **Traditional training panels** (ADR-024 §4.2): a trained model is
   commercially ownable (FAR/FRR report before export).

### Phase 6 — Polish, PWA, packaging, docs — ⏳ Pending

1. **Offline:** vendor the onnxruntime-web wasm pair locally and point
   `ort.env.wasm.wasmPaths` at it (CDN dependency gone); asset pre-fetch per
   the ADR-011 amendment with checksum verification.
2. **CI/CD activation (ADR-015):** fix the `deploy.yml` Cloudflare
   `--project-name` rename (wave-studio → wake-studio, ADR-014); fetch wasm
   before build in deploy jobs; configure environments/secrets; run the first
   manual deploy; enforce CI green on PRs (also resolves the P0 blockers
   below).
3. **Accessibility + i18n scaffold** (English first, per repo policy),
   keyboard shortcuts, empty/loading/error states, onboarding tour.
4. **PWA quality:** Lighthouse PWA = 100, performance ≥ 90 on the deployed
   build; security review (mic permissions, CSP, credential handling).
5. **Docs reconcile:** `docs/modules/*.md` with shipped reality; public docs
   site.

### Phase 7 — v1.x backlog (documented, unprioritized)

WebRTC AEC3 WASM (ADR-016 deferral); Silero VAD gating (ADR-018 deferral);
ESP32-S3 golden path; PocketSphinx backend + full MCU demo (ADR-043 deferral,
#40); openWakeWord
training-verifier integration; node-per-stage AudioWorklet topology (ADR-016).

## 7. Live work state (GitHub)

Task state lives in **Issues + the `WakeStudio Delivery` project** (org
`awareride`, project #2); load it with `gh project item-list 2 --owner
awareride` (see `CONTRIBUTING.md`). This doc only keeps pointers.

**P0 blockers** (delivery chain — all resolved): issues
[#27](https://github.com/awareride/wake-studio/issues/27) (lint red in
contracts/test-kit), [#28](https://github.com/awareride/wake-studio/issues/28)
(playwright CI resolution), [#29](https://github.com/awareride/wake-studio/issues/29)
(deploy wasm fetch + Cloudflare rename), [#30](https://github.com/awareride/wake-studio/issues/30)
(vendor ONNX wasm / offline) — all closed 2026-08-12 (Done on the board).

**Open questions**: all resolved (each lands as an ADR): Q10 (#32) →
ADR-042 (no wakeforge; module-owned openWakeWord pipeline), Q11 (#33) →
ADR-026 (L3 = merge-gate), Q13 (#35) → ADR-040 (native-first SDK CI), Q14
(#36) → ADR-041 (onnxruntime-web wasm vendored now via P0-4), Q12 (#34) →
ADR-043 (PocketSphinx deferred to v1.x).

**Next actions** (from the board): finish Phase 4 SDK — microwakeword driver
(#185), Raspberry Pi Python binding (#187), plix driver (#188), bundle
generator (#189); then license gate (#42).

## 8. Risks & mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Device SDK (Phase 4) is a large C/C++ deliverable with no precedent in this repo | High | High | Validate with one C unit-test harness + one golden-path target (Cortex-M) first; keep the JS PWA unchanged; CI runs a native SDK build on every PR |
| Export bundles can accidentally ship CC BY-NC-SA models commercially | High | High | License gate (already scaffolded); always train our own models (Phase 5); `LICENSES.md` matrix |
| Few-Shot high false-alarm rate (only 3–5 samples) | High | Medium | Negative prototypes + VAD gating + min-duration smoothing (shipped) |
| Cloud-provider credential leakage | Medium | High | Credentials client-side only; never logged/exported; Phase 6 security review |
| onnxruntime-web wasm on CDN breaks offline promise | Medium | Medium | Resolved — vendored locally (P0-4 #30, closed) |
| Browser WebGPU/WASM SIMD support varies | Medium | Medium | Feature-detect + WASM fallback |
| CI red (P0-1/P0-2) blocks all PRs | High | High | Resolved 2026-08-12 (P0s #27/#28 closed); CI green is enforced on PRs |

## 9. Out of scope (non-goals for v1)

- Cloud/server-side processing of the **live pipeline** (capture/AFE/KWS stays
  100% client-first).
- Continuous large-vocabulary ASR (KWS + optional short command words only).
- Training new foundation encoders (we freeze PLiX / Google speech_embedding /
  sherpa transducer models).
- Multi-user / multi-wake-word simultaneous detection on MCU.
- A proprietary/commercial KWS engine (optional, clearly-marked upgrade path).
- Real AEC/BSS DSP in the browser (deferred to v1.x; device-side vendor AFE in
  exports).

## 10. References

- openWakeWord: https://github.com/dscripka/openWakeWord (Apache-2.0 code;
  CC BY-NC-SA pre-trained models)
- micro-wake-word: https://github.com/OHF-Voice/micro-wake-word (Apache-2.0)
- sherpa-onnx: https://github.com/k2-fsa/sherpa-onnx (Apache-2.0)
- wakeforge (`ww_trainer`): https://github.com/TigreGotico/wakeforge
  (Apache-2.0; optional future eval, ADR-042)
- PLiX KWS: https://github.com/aaqibsaeed/plixkws (Apache-2.0)
- PocketSphinx: https://github.com/cmusphinx/pocketsphinx (BSD-style)
- RNNoise: https://gitlab.xiph.org/xiph/rnnoise ; wasm ports (jitsi/timephy)
- Silero VAD: https://github.com/snakers4/silero-vad (MIT)
- Piper: https://github.com/OHF-Voice/piper1-gpl (GPL-3.0, active) /
  https://github.com/rhasspy/piper (MIT, archived)
- onnxruntime-web: https://onnxruntime.ai/docs/get-started/with-javascript.html
- WavLM (superseded by PLiX, ADR-002):
  https://huggingface.co/microsoft/wavlm-base-plus (MIT)
- Pre-research: `docs/Technical Pre-Research & Feasibility Study_ On-Device
  Wake Word Detection Systems.md`; `docs/Technical Reference_ Resource
  Requirements and Zero-Python Deployment Strategies for WavLM-base-plus and
  plixkws.md`
