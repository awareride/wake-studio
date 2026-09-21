# plix module — device target

`PLiX Few-Shot` (aaqibsaeed/plixkws, Apache-2.0) is the **app-class
enrollment-based backend** (ADR-002/020): a frozen encoder (1280-dim
embedding) plus prototype-distance scoring. On device the encoder runs
through the shared onnxruntime C API (pinned 1.21.0 — the same runtime as
openwakeword #192 / kws-streaming #194); the prototype vector rides the
bundle config, not a model file (#188).

## Current state (slices 1–2, issue #188)

The full detection loop ships (`wake_kws_plix_ops`) behind
`WAKE_SDK_PLIX_HAS_RUNTIME` (default OFF; the OFF build still compiles,
registers, and warmups — see the L1 contract face):

- **Encoder session:** `plixkws-small.onnx` opened by file path (external
  `.data` resolves), `[1,1,64,100]` float32 contract verified, output name
  prefers `embeddings` (browser parity).
- **Frontend:** C99 mel port (`plix_frontend.c`, no heap after init):
  Hann-400, FFT-1024 (kissfft), Slaney-64 60–7800 Hz, raw magnitude
  (the graph logs internally). Parity locked by L1 fixtures generated from
  the dsp package itself (worst measured diff 1.6e-5, tol 1e-3) plus the
  exact emit cadence (104 frames per 16960 samples).
- **Detection loop** (`core/backend.ts` parity): 1.5 s ring, 80 ms hop with
  zero-order hold, silence gate at −45 dBFS (score 0, no invoke), mel over
  the oldest 16240 samples (= first 100 frames, `fitFrames`-head parity),
  L2-normalized prototype distance `1/(1+d²)` (+ 2-class negative softmax).
- **Prototype:** provisional sidecar `<model_dir>/plix_prototype.json`
  (`{"vector":[...1280...], "negativeVector":[...]}`) until the bundle
  generator (#189) designs the config file; strict parser, required at
  load (Few-Shot has no default word).
- **L1:** contract face + frontend parity + staged-bundle inference
  (finite `[0,1]` posteriors on sine, exact-0 silence gate, warmup after
  reset). Scoring math verified host-side against independent
  recomputation (bit-exact).

## Next steps (follow-ups, not this commit)

1. **Trigger-word validation:** L1 uses a constant prototype; a real
   enrolled clip asserting an actual trigger needs recorded speech
   (same gap as #185's trigger clip).
2. **Bundle generator (#189)** absorbs the prototype sidecar into the
   designed config file.

Fetch the runtime + model with:

```
node scripts/fetch-onnxruntime.mjs          # linux-x64 | linux-aarch64 | osx-universal2
node scripts/fetch-artifact.mjs kws-plix    # models-plix-v1 release -> module assets/
```
