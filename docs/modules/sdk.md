# Device-Side SDK — Module Specification

- **Status:** Draft v2 (filled at Phase 4 start per the docs-first rule; ADR-040 records the core decisions)
- **Owner:** WakeStudio team
- **Plan phase:** Phase 4 (reshaped by ADR-021; epic #31)
- **Related ADRs:** ADR-019 (target matrix), ADR-020 (pluggable KWS backends), ADR-021 (device-side SDK), ADR-003/016 (AFE), ADR-024 (KWS decoupling), ADR-025 (module platform), ADR-034 (composition roots), ADR-040 (core language / placement / profiles / CI)
- **Depends on (modules):** KWS (`KWSBackend` interface), AFE (RNNoise/WebRTC cores), Export (bundle generation)
- **Last updated:** 2026-08-19

## 1. Purpose

WakeStudio develops a **layered portable device-side SDK**, and **every export
workflow is built upon it** (ADR-021). The SDK is the shared substrate that lets
WakeStudio emit application templates for the full target matrix (ADR-019) —
Arm Cortex-M (STM32, Arduino), Raspberry Pi, Android, iOS, browsers, and desktop
(Linux/macOS/Windows) — without maintaining N divergent codepaths. The in-browser
PWA demo also consumes the same `KWSBackend` interface (via the JS/WASM binding)
so the demo and the exports stay consistent.

**Module-ownership principle (ADR-025, extended):** every KWS backend and every
AFE stage is a **self-contained module** that owns *everything about its
component* — its spec, its browser driver, its training adapter, its
**on-device run code**, its assets, and its tests. Adding a component (e.g. a new
KWS backend or AFE stage) = new module + one line in the composition root; the
SDK core is never edited (ADR-024 decoupling rule, now on device).

## 2. Scope & boundaries

- **In scope:**
  - A target-agnostic **Core (C++17 with a strict C ABI)**: the `KWSBackend`
    interface (ADR-020), the generic detection loop, a portable AFE graph,
    audio-I/O + threading + clock + memory abstractions, VAD, config and
    capabilities. See ADR-040 §1 for the language/ABI rationale.
  - **Per-component modules** (one per KWS backend / AFE stage), each carrying
    its `device/` implementation (C/C++ driver + CMake target).
  - **Target adapters**: per-platform implementations of the abstractions
    (audio capture, model runtime, threading) for each target in ADR-019.
  - **Language bindings**: C API (universal), Python (Linux/macOS/Windows,
    ctypes), Kotlin (Android, JNI), Swift (iOS), JS/WASM (browsers,
    emscripten), C/TFLite-Micro (Cortex-M, ESP32).
  - The **bundle layout** every export emits: SDK adapter + model + AFE config +
    `demo/` + `README.md` + `LICENSES.md` + `test/` (FAR/FRR).
- **Out of scope:**
  - Training (owned by the Training module / Phase 5 + ADR-013 backends) —
    although each module *owns its train adapter*, the training *platform* is
    shared (`train-kit`, job manager).
  - Audio-data sourcing (owned by the Data-Sources module / ADR-022).
  - The PWA UI itself (the Studio), which *uses* the JS/WASM binding but is not
    part of the exported SDK.
- **Public surface:** the `KWSBackend` C API, the AFE/abstraction headers, the
  per-target adapter entry points, and the bundle generator contract.

## 3. Dependencies

- **Upstream (consumes from):** KWS module (`KWSBackend` interface + adapters:
  openWakeWord, micro-wake-word, PLiX Few-Shot, PocketSphinx, sherpa-onnx —
  ADR-020); AFE module (portable NS/AEC cores).
- **Downstream (provides to):** Export module (Phase 4 bundle generation); the
  in-browser PWA demo (JS/WASM binding).
- **External libraries / models:** TFLite-Micro (Apache-2.0), onnxruntime
  (Apache-2.0, C API), RNNoise (BSD-3), WebRTC audio_processing (BSD-3),
  PocketSphinx (BSD), micro-wake-word (Apache-2.0). See `LICENSES.md`;
  per-target `LICENSES.md` applies because vendor/model licenses differ.

## 4. Public API & types

### 4.1 The `KWSBackend` C interface (Q-SDK-1 resolved)

Mirrors the in-browser `KWSBackend` (TypeScript) one-to-one so the demo and the
exports stay consistent (ADR-021). A single op-struct + handle:

```c
/* core/include/wake/kws_backend.h */
typedef struct wake_kws_backend wake_kws_backend_t;   /* opaque handle */

typedef struct wake_kws_backend_ops {
    const char *id;                                    /* 'microwakeword' | 'plixkws' | ... */
    const char *label;
    void *(*create)(const wake_kws_config_t *cfg);     /* instance factory */
    void (*destroy)(void *impl);
    /* Load the backend's models from the bundle dir. Returns 0 on success. */
    int (*load)(void *impl, const wake_model_bundle_t *models,
                const wake_kws_config_t *cfg);
    /* Process one AFE frame (160 samples / 10 ms @ 16 kHz). Returns raw
       posterior [0,1], or -1 during warmup. */
    float (*process_frame)(void *impl, const int16_t *samples, size_t n);
    void (*reset)(void *impl);
} wake_kws_backend_ops_t;

/* A backend is registered by the composition root, one line per module. */
int wake_sdk_register_kws_backend(wake_sdk_t *sdk,
                                  const wake_kws_backend_ops_t *ops);
```

On device, models are **files** in a bundle directory
(`wake_model_bundle_t.model_dir` — the driver reads the names it declared),
not URLs; the bundle generator (#189) emits the model files next to the
config.

The generic **detection loop lives in the core** (never in a module): VAD gate →
smoothed score (sliding-window max) → threshold + min-duration → cooldown —
a direct port of `packages/modules/kws/engine/core/logic.ts` (pure math). The
core owns threading/clocking; the backend owns model-specific inference and its
own audio windowing/buffering — exactly the browser split (ADR-018).

### 4.2 AFE stage interface

```c
/* core/include/wake/afe_graph.h */
typedef struct wake_afe_stage wake_afe_stage_t;

typedef struct wake_afe_stage_ops {
    const char *id;              /* 'aec' | 'bss' | 'ns' */
    const char *label;
    void *(*create)(void);
    void (*destroy)(void *impl);
    /* One 10 ms frame (160 samples @ 16 kHz) in place. `vad_out` may be
       NULL; a stage that carries VAD writes its probability [0,1] there. */
    int (*process)(void *impl, int16_t *frames, size_t n, float *vad_out);
    void (*reset)(void *impl);
} wake_afe_stage_ops_t;

int wake_sdk_register_afe_stage(wake_sdk_t *sdk, const wake_afe_stage_ops_t *ops);

/* per-pipeline graph: append (in order) + process + reset */
wake_afe_graph_t *wake_afe_graph_create(void);
int wake_afe_graph_append(wake_afe_graph_t *g, const wake_afe_stage_ops_t *ops);
int wake_afe_graph_process(wake_afe_graph_t *g, int16_t *frames, size_t n,
                           float *vad_out);
```

Strict pipeline order is **AEC → BSS → NS → VAD → KWS** (ADR-001/016); the
composition root appends in that order. AEC/BSS are passthrough for v1
(ADR-016) with vendor adapter slots (WebRTC/SpeexDSP). The RNNoise NS stage
(module `afe/rnnoise/device/`, vendored `third_party/rnnoise` v0.1.1) both
denoises and **carries the VAD probability** (browser parity — the browser
derives VAD from the same RNNoise engine); it slips 160-sample graph frames
into RNNoise's 480-sample frames (30 ms latency, streaming, no sample loss).

### 4.3 Capabilities & config

- `wake_sdk_capabilities_t wake_sdk_capabilities(const wake_sdk_t *sdk)` —
  returns the *build's* capabilities: registered backend ids, sample rates,
  heap budget, `vad`, `threading`, `float_dsp`. This is the device twin of the
  browser registry's `browserFeasible` (ADR-020): the bundle generator uses it
  to pick what to ship, the demo uses it to show what works on *this* build.
- Config is spec-driven: every module's tunables come from its
  `module.spec.json` (`describeParameters()` on the web side, ADR-017/025). The
  device side receives the same keys via the bundle's config file — **one
  schema, two worlds**, no divergent config.

## 5. Architecture & module layout

### 5.1 Physical layout (ADR-040 §2: device code inside the module)

The device implementation of a component lives **inside its module**, per the
CONTRIBUTING layout (`packages/modules/<category>/<name>/{core,web,node,train,device,spec,tests}`):

```
packages/modules/kws/openwakeword/
├── module.spec.json      ← single fact source: params, asset recipe, train contract, device config
├── src/                  ← browser driver (JS/TS)
├── train/                ← training adapter
├── device/               ← C/C++ driver + CMakeLists.txt (on-device run code)
├── assets/               ← ADR-027 fetch/build recipe (gitignored binaries)
├── tests/                ← L1 unit + L2 boot tests (browser + device)
└── LICENSES.md           ← module-owned license declarations
```

Top-level `device/` is the **CMake aggregation tree**, not a mirror of the
modules:

```
device/
├── CMakeLists.txt            # add_subdirectory over core + selected module device/ dirs + adapters
├── core/                     # SDK core (C++17, C ABI headers in core/include/wake/)
│   ├── kws_backend.h  afe_graph.h  config.h  capabilities.h
│   ├── audio_io.h  clock.h  thread.h  alloc.h
│   ├── detection.cxx          # port of engine/core/logic.ts
│   └── CMakeLists.txt
├── adapters/                 # per-target: cortex-m/, pi/, android/, ios/, desktop/, wasm/
├── cmake/                    # toolchains, profile presets
└── tests/                    # composition-root integration tests (native harness)
```

`packages/sdk` (npm package) holds the SDK's *public binding package*: the C API
headers' language-facing side (JS/WASM binding for the PWA + bundle tooling that
emits composition roots) and SDK docs. `device/` holds the C/C++ source itself.

### 5.2 Registration: link-time composition root (ADR-040 §3)

No dynamic import exists on device, so registration is **link-time**, via an
explicit composition root — the ADR-034 concept ported to C. Each module exports
a registration entry (`wake_register_kws_backend(...)`,
`wake_register_afe_stage(...)`); the composition root is the **only** file that
calls them:

```c
/* device/composition/<profile>_root.cxx — one line per module */
void wake_sdk_compose(wake_sdk_t *sdk) {
    wake_register_afe_stage(sdk, &afe_ns_ops, afe_ns_create);        /* afe/ns   */
    wake_register_afe_stage(sdk, &afe_vad_ops, afe_vad_create);      /* afe/vad  */
    wake_register_kws_backend(sdk, &kws_microwakeword_ops,
                              kws_microwakeword_create);             /* kws/microwakeword */
}
```

The root is hand-written or **generated by the bundle generator** from the
selected modules' specs (see §9). `__attribute__((constructor))` and linker
section tricks are avoided: fragile on bare-metal (linker scripts, startup
code), nondeterministic. An explicit root is debuggable and testable.

### 5.4 Device drivers (per-backend `device/` targets)

Each driver is a self-contained module target — `wake_kws_<id>` — behind the
same C `KWSBackend` op-struct, **runtime-gated** by a CMake option so the
module always compiles/registers and only links its runtime when the build
asks for it. A driver without its runtime still appears in capabilities;
`load()` fails loudly ("runtime not linked") and `process_frame()` stays in
warmup (`-1`). The bundle generator picks the runtime-ON configuration.

| Driver (issue) | Module `device/` | Runtime | Gate option |
|---|---|---|---|
| microwakeword (#185) | `kws/microwakeword/device/` | TFLite-Micro (pinned, `third_party/tflite-micro`) | `WAKE_SDK_MICROWAKEWORD_HAS_RUNTIME` |
| openwakeword (#192) | `kws/openwakeword/device/` | onnxruntime C API (pinned 1.21.0, `third_party/onnxruntime`, fetched prebuilt) | `WAKE_SDK_OPENWAKEWORD_HAS_RUNTIME` |
| kws-streaming (#194) | `kws/streaming/device/` | onnxruntime C API (same pinned dep as openwakeword) | `WAKE_SDK_KWS_STREAMING_HAS_RUNTIME` |
| sherpa-onnx-kws (#193) | `kws/sherpa/device/` | sherpa-onnx C API (pinned v1.13.6, `third_party/sherpa-onnx`, fetched prebuilt; bundles its own onnxruntime) | `WAKE_SDK_SHERPA_HAS_RUNTIME` |

**onnxruntime (shared app-class runtime).** Two drivers share the pinned
onnxruntime C API: openwakeword (mel → embedding → classifier, a byte-for-byte
port of `core/backend.ts`) and kws-streaming (the same kwt\*.onnx graphs the
browser runs, **manifest-driven**: a sidecar `manifest.json` — the browser's
own sidecar contract — describes mode, tensor names, window/packet sizes and
labels, so one driver serves every topology upstream ships, in both
`sliding-window` and `streaming-external-state` shapes). Both read model files
from the bundle `model_dir` under driver-declared names — no URL bag on
device (ADR-040 §4.1).

**sherpa-onnx (ASR-Decoding).** The sherpa driver runs the same
encoder/decoder/joiner transducer the browser wasm runs, through the native
KeywordSpotter C API. It is **hit-based**, not a per-frame posterior:
`process_frame()` returns 1.0 on a keyword hit (held ~400 ms so the
min-duration gate clears), 0.0 otherwise — browser parity.

### 5.3 Low-power vs high-performance: profiles, not forks (ADR-040 §4)

One core; the mcu/app distinction is **preset configurations**:

- **Compile-time profile** (`WAKE_SDK_PROFILE=mcu|app`): selects feature macros
  (which modules link, `WAKE_SDK_HAVE_VAD`, heap budget, int16 vs float DSP,
  frame sizes, threading on/off). MCU build = static buffers, no threads,
  single backend; app build = heap + threads + multi-backend.
- **Runtime capabilities** (§4.3) report the profile's reality to demos and the
  bundle generator.
- Backend selection stays data-driven end-to-end: export UI picks
  (profile, backend, AFE mode) → bundle generator emits the matching CMake
  target list + composition root + defaults. MCU bundles register only
  `microwakeword`; app bundles register plix/openwakeword/sherpa/pocketsphinx.

## 6. Data flow / sequence

One path for every target (mirrors the browser pipeline):

```
audio in → [adapter: capture] → [core: AFE graph 16 kHz, 10 ms frames]
         → [core: KWSBackend.process_frame] → [core: detection loop]
         → trigger → [adapter: notify/callback]
```

- Capture is adapter-owned (PCM16 frames at the device rate); the core
  resamples to 16 kHz at the AFE boundary (sample-rate support is a capability).
- The per-pipeline runtime is `wake_pipeline_t` (core): it builds the AFE
  graph from the registered stages (ADR-001 order), creates the named
  backend, and wires smoothing → VAD gate → threshold + min-duration →
  cooldown (`wake/detection.h`, port of `logic.ts`).
- The loop emits score/trigger events the same shape as the browser
  `KWSScoreSample` / `KWSTriggerEvent` (`wake_score_sample_t` /
  `wake_trigger_event_t`: capturedAtMs, rawScore, smoothedScore, triggered,
  vadProbability). VAD-gated frames skip inference and do not push into the
  smoother window (max-pooling keeps the recent peak, browser parity).
- The host CLI demo (`device/tools/wake-sdk-demo`, `wake-sdk-demo input.wav`)
  drives this path end-to-end on the dev host: wav → AFE → RMS reference
  backend → trigger print (exit 0 on trigger, 1 otherwise).

## 7. Error model & failure modes

- Model-load failure, audio-device failure, and backend-incompatibility
  (e.g. a backend too large for a target) are distinct error codes; the demo and
  bundles degrade gracefully by capability (`wake_sdk_capabilities`), falling
  back to a lighter backend when available (ADR-020).
- No exceptions on device builds (`-fno-exceptions`); errors are `int` codes
  from the C API. Memory exhaustion fails allocation up front (arena), never
  mid-inference.

## 8. Observability

- The SDK exposes score/VAD/latency telemetry via a small callback/log seam, so
  the in-app UI (JS/WASM binding) and exported demos (serial/log channel) render
  the same per-frame data the browser shows today.

## 9. Bundle generation contract

Every export is an SDK-based project: model(s) + `labels.json` + AFE config +
SDK adapter + generated composition root + `demo/` + `README.md` + `LICENSES.md`
(assembled from per-module declarations) + `test/` (FAR/FRR script). The
generator is the consumer of `module.spec.json`: selected modules → CMake target
list + composition root + defaults. A bundle is *buildable and runnable* on its
target — this is the hard acceptance for #41.

## 10. Testing strategy (ADR-026 applied to the device world)

- **L1 unit tests per module** (native build): detection loop port fidelity,
  backend/stage registries, AFE graph, RNNoise NS/VAD (silence vs loud-signal
  VAD ordering), WAV reader.
- **Composition-root integration test** (native harness, macOS/Linux):
  assemble core + AFE stages (aec/bss/ns) + the RMS reference backend, feed
  a tone wav, assert a trigger — the L2-style boot test for device; runs on
  the developer's host, zero hardware. Tested in CI (`ctest`).
- **CLI demo smoke** (CI): `wake-sdk-demo` on a generated tone wav exits 0
  (trigger) and on silence exits 1 (no trigger).
- **Cross-compile builds** (Cortex-M `arm-none-eabi`) in CI: build + link +
  unit tests, no hardware required.
- **On-hardware validation**: final acceptance for golden paths only (Cortex-M
  triggers on the wake word; Pi bundle runs and triggers).
- **CI (Q13/#35, ADR-040 §5):** native gcc/clang build + tests on every PR
  first; Cortex-M cross-compile in the same job matrix.

## 11. Security & privacy

- The SDK processes mic audio on-device; no audio leaves the device in exported
  deployments.
- No credentials are bundled into exported artifacts (ADR-013 security note).
- Licenses travel with every bundle: per-module declarations → generated
  `LICENSES.md`; the Phase 4 gate (#42) blocks CC BY-NC-SA models from
  commercial exports.

## 12. Implementation sequence (ADR-040 §6)

1. SDK `device/` layout + module `device/` convention + core skeleton + CMake
   aggregation (scaffolding).
2. Core: `KWSBackend` C API + detection loop + config/capabilities.
3. Core: AFE graph + RNNoise NS + VAD device modules.
4. **Native test harness + CLI demo** (macOS/Linux host, Q13 native-first).
5. Device CI job (native build + unit tests, every PR).
6. Composition root + profile system (mcu/app) + capabilities query.
7. microwakeword device driver (TFLite-Micro) + Cortex-M cross-compile in CI.
8. Raspberry Pi Python binding golden path.
9. openwakeword + kws-streaming + sherpa-onnx-kws device drivers shipped
   (onnxruntime shared runtime; sherpa-onnx prebuilt); plix reuses the
   pattern as a follow-up; microwakeword (TFLite-Micro) lands the MCU tier.
10. On-hardware MCU validation (buy one cheap STM32/Arduino board for the
    golden-path acceptance).
11. Android (JNI) / iOS (Swift) / desktop bindings; bundle generator consumes
    specs (#39/#41).

## 13. Open questions

- `[Q-SDK-2]` iOS: ONNX Runtime vs Core ML for the PLiX/openWakeWord path
  (resolved at binding time).
- `[Q-SDK-3]` ESP32 (deferred target, ADR-019): adapter scope vs
  Cortex-M-first sequencing (stays deferred).

## 14. References

- ADR-019 (target matrix), ADR-020 (pluggable KWS backends), ADR-021 (device
  SDK), ADR-024 (decoupling), ADR-025 (module platform), ADR-034 (composition
  roots), ADR-040 (core language / placement / profiles / CI).
- `docs/architecture.md` §6 (export matrix), `docs/modules/kws.md`,
  `docs/modules/afe.md`, `docs/modules/export.md`, `LICENSES.md`.

## 15. Change log

| Date | Change | Author |
|---|---|---|
| 2026-07-27 | Initial stub (ADR-021 recorded; full contract deferred to Phase 4 start). | WakeStudio team |
| 2026-08-19 | Draft v2: module-ownership (device code inside modules, ADR-040 §2), KWSBackend C API + detection loop (Q-SDK-1 resolved), AFE stage interface, composition root, profiles + capabilities, bundle contract, testing, sequence. | WakeStudio team |
