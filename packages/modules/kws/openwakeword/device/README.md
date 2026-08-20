# openwakeword module — device target

`openWakeWord` (Apache-2.0) is the **app-class Traditional backend**
(ADR-019/020/024): melspectrogram → speech_embedding → classifier, three onnx
models run through the **onnxruntime C API** — the shared app-class runtime
(kws-streaming #194 reuses the same pinned dependency).

The browser driver (`core/backend.ts`) is the reference for pipeline order +
streaming windowing; this C driver is a byte-for-byte port of its semantics:
1280-sample chunks + 480-sample overlap → mel frames → last 76 frames →
96-dim embedding → 16-embedding ring → classifier score.

## Current state

The full C `KWSBackend` adapter ships (`wake_kws_openwakeword_ops`):
create / load(model_dir) / process_frame / reset / destroy, plus the CMake
target and the runtime-gating option `WAKE_SDK_OPENWAKEWORD_HAS_RUNTIME`
(default OFF).

Without the runtime the module still compiles, registers, and appears in
capabilities; `load()` returns a clear "runtime not linked" error and
`process_frame()` stays in warmup (`-1`).

## Runtime (onnxruntime C API)

Pinned release **1.21.0** (ADR-031 style; live upstream — ADR-037 Tier 1-2,
no source vendoring). Fetched per host into `third_party/onnxruntime/<host>`
(gitignored):

```bash
node scripts/fetch-onnxruntime.mjs          # linux-x64 | osx-universal2
cmake -S device -B build -DCMAKE_BUILD_TYPE=Debug -DWAKE_SDK_PROFILE=app \
  -DWAKE_SDK_OPENWAKEWORD_HAS_RUNTIME=ON
cmake --build build -j
ctest --test-dir build --output-on-failure
```

The L1 test exercises the real pipeline when a model dir is supplied:

```bash
cmake -S device -B build ... -DWAKE_SDK_OPENWAKEWORD_HAS_RUNTIME=ON \
  -DWAKE_OPENWAKEWORD_MODEL_DIR=<dir-with-the-3-onnx>
```

## Model files (driver-declared names, ADR-040 §4.1)

The driver reads these names from the bundle's `model_dir`:

| File | Model | I/O |
|---|---|---|
| `melspectrogram.onnx` | openWakeWord log-Mel front-end (Apache-2.0) | `[1, samples]` → `[1, 1, time, 32]` |
| `embedding_model.onnx` | Google speech_embedding backbone re-impl (Apache-2.0) | `[1, 76, 32, 1]` → `[1, 1, 1, 96]` |
| `classifier.onnx` | per-wake-word classifier (e.g. hey-buddy, CC-BY-4.0) | `[1, 16, 96]` → `[1, 1]` |

Fetched via `node scripts/fetch-artifact.mjs kws-openwakeword` (ADR-027,
`models-openwakeword-v1` release). The `hey-buddy` classifier is
**commercially clean (CC-BY-4.0)**; CC BY-NC-SA demo models (e.g. `alexa`,
`hey_jarvis`) must never enter commercial bundles (license gate #42).

## Why C, not C++

The onnxruntime C API is a plain C interface; the driver holds no C++ objects
and keeps the module linkable into any profile/ABI without a C++ runtime
story (consistent with the other drivers; the SDK core is C++17 behind the C
ABI per ADR-040 §1).
