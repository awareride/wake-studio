# plix module — device target

`PLiX Few-Shot` (aaqibsaeed/plixkws, Apache-2.0) is the **app-class
enrollment-based backend** (ADR-002/020): a frozen encoder (1280-dim
embedding) plus prototype-distance scoring. On device the encoder runs
through the shared onnxruntime C API (pinned 1.21.0 — the same runtime as
openwakeword #192 / kws-streaming #194); the prototype vector rides the
bundle config, not a model file (#188).

## Current state (slice 1, issue #188)

The encoder session ships (`wake_kws_plix_ops`): create / load
(`plixkws-small.onnx` + colocated `plixkws-small.onnx.data`, dims verified
`[1,1,64,100]` float32) / destroy, plus the CMake target and the
runtime-gating option `WAKE_SDK_PLIX_HAS_RUNTIME` (default OFF).

`process_frame()` stays in warmup (`-1`) until slice 2 — scoring needs the
C mel frontend, which does not exist yet.

## Next steps (follow-ups, not this commit)

1. **C mel frontend (slice 2):** 16 kHz audio → 64-bin raw-magnitude mel,
   win 400 / hop 160 / n_fft 1024, 60–7800 Hz, fit to 100 frames
   (`packages/modules/kws/plix/encoders/plix-frontend.ts` contract — the
   graph logs internally, so the frontend must stay raw magnitude).
2. **Prototype scoring (slice 2/3):** L2-normalize, squared distance,
   `1/(1+d2)` (+ optional 2-class softmax with the negative prototype),
   silence gate at −45 dBFS, 80 ms hop, 1.5 s window
   (`core/backend.ts` contract); prototype vector from the bundle config
   (`docs/modules/sdk.md` §4.3).

Fetch the runtime + model with:

```
node scripts/fetch-onnxruntime.mjs          # linux-x64 | linux-aarch64 | osx-universal2
node scripts/fetch-artifact.mjs kws-plix    # models-plix-v1 release -> module assets/
```
