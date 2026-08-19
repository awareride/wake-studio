# sherpa-onnx-kws module — device target

`sherpa-onnx` (Apache-2.0, k2-fsa) is the **ASR-Decoding category** backend
(ADR-024): a real KWS transducer (`KeywordSpotter`) tuned for fixed wake
words. The browser driver (`core/backend.ts`) runs the same library compiled
to wasm; the device driver runs the **same encoder/decoder/joiner onnx
models** through the native sherpa-onnx C API.

## Current state

The full C `KWSBackend` adapter ships (`wake_kws_sherpa_ops`):
create / load(model_dir) / process_frame / reset / destroy, plus the CMake
target and the runtime-gating option `WAKE_SDK_SHERPA_HAS_RUNTIME` (default
OFF).

Without the runtime the module still compiles, registers, and appears in
capabilities; `load()` returns a clear "runtime not linked" error and
`process_frame()` stays in warmup (`-1`).

## Runtime (sherpa-onnx prebuilt, pinned 1.13.6)

Pinned release **v1.13.6** (ADR-031 style; live upstream — ADR-037 Tier 1-2,
no source vendoring). The shared tarball bundles its own onnxruntime, so no
separate runtime is needed. Fetched per host into
`third_party/sherpa-onnx/<host>` (gitignored):

```bash
node scripts/fetch-sherpa-onnx.mjs          # linux-x64 | osx-arm64
cmake -S device -B build -DCMAKE_BUILD_TYPE=Debug -DWAKE_SDK_PROFILE=app \
  -DWAKE_SDK_SHERPA_HAS_RUNTIME=ON
cmake --build build -j
ctest --test-dir build --output-on-failure
```

The L1 test exercises the real transducer when a model dir is supplied:

```bash
cmake -S device -B build ... -DWAKE_SDK_SHERPA_HAS_RUNTIME=ON \
  -DWAKE_SHERPA_MODEL_DIR=<dir-with-model-files>
```

## Model files (driver-declared names, ADR-040 §4.1)

The driver reads these names from the bundle's `model_dir`:

| File | Content |
|---|---|
| `encoder.onnx` / `decoder.onnx` / `joiner.onnx` | the KWS transducer (chunk-16 variant, e.g. `sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20`) |
| `tokens.txt` | BPE token list |
| `keywords.txt` | keyword list in sherpa phone format, one per line (`L AY1 T AH1 P @LIGHT_UP`) — spec-driven, the bundle generator emits it |
| `trigger.wav` | a positive wake-word clip (test-only, staged by CI) |

Fetched from the `kws-models` release
(`sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20.tar.bz2`); the module's
`fetch-artifact` recipe covers the browser wasm bundle — the device driver's
model files are fetched directly from the same upstream release (pinned URL,
see `device.yml`).

## Scoring semantics (browser parity)

sherpa KWS is **hit-based**, not a per-frame posterior: `process_frame()`
returns `1.0` on a keyword hit (held ~400 ms so the engine's min-duration
gate clears), `0.0` otherwise, and `-1` only before `load()`. The core's
smoothing/threshold/cooldown handle the rest (ADR-018).
