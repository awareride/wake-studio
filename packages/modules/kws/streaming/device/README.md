# kws-streaming module — device target

`kws_streaming` (Google Research, vendored per ADR-037; Apache-2.0) is the
**Traditional external-state streaming graph** backend (ADR-020/024 §2.1).
The device driver runs the **same kwt\*.onnx models** the browser runs via
onnxruntime-web, through the **onnxruntime C API** — the shared app-class
runtime (openwakeword #192 uses the same pinned dependency).

## Manifest-driven, one driver for every topology

The driver is configured by the sidecar **`manifest.json`** — the browser's
own sidecar contract (`core/manifest.ts`), parsed by a small embedded JSON
DOM. One driver serves every streamable topology upstream ships, in both
inference shapes:

- `sliding-window` (kwt1/2/3, att_mh_rnn_1): the non-streaming graph runs
  over the most recent `windowSamples` (1 s), re-evaluated every
  `hopSamples` (100 ms); windows overlap and left zero-pad until primed.
- `streaming-external-state`: packet-sized steps with explicit state tensors
  in/out; the driver carries the state bags across steps (advanceStates
  parity, `streaming.ts`).

The multi-class output (Speech Commands 12 labels) is mapped to a single
`[0,1]` score: softmax when the graph did not (`softmaxed: false`), then the
wanted word's column (`wantedWord` from the manifest).

`featureExtractor: "external"` (features computed outside the graph) is not
supported — matches browser Q-KS-2.

## Model files (driver-declared names, ADR-040 §4.1)

| File | Content |
|---|---|
| `model.onnx` | the exported graph (any topology) |
| `manifest.json` | the sidecar manifest (`core/manifest.ts`) |

Fetched via `node scripts/fetch-artifact.mjs kws-streaming` (ADR-027,
`kws-streaming-onnx` artifact, built by `build.yaml` from the vendored
upstream — no pretrained weights ship in the repo).

## Current state

The full C `KWSBackend` adapter ships (`wake_kws_streaming_ops`):
create / load(model_dir) / process_frame / reset / destroy, plus the CMake
target and the runtime-gating option `WAKE_SDK_KWS_STREAMING_HAS_RUNTIME`
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
  -DWAKE_SDK_KWS_STREAMING_HAS_RUNTIME=ON
cmake --build build -j
ctest --test-dir build --output-on-failure
```

The L1 test exercises the real graph when a model dir is supplied:

```bash
cmake -S device -B build ... -DWAKE_SDK_KWS_STREAMING_HAS_RUNTIME=ON \
  -DWAKE_KWS_STREAMING_MODEL_DIR=<dir-with-model.onnx-and-manifest.json>
```

The shipped kwt1 asset is `sliding-window` mode; the `streaming-external-state`
path is implemented and manifest-gated but has no shipped asset yet (verified
end-to-end once an external-state model is trained/exported).
