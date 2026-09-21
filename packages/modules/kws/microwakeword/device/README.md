# microwakeword module — device target

`micro-wake-word` (OHF-Voice, Apache-2.0) is the **MCU-tier primary backend**
(ADR-019/020): TFLite-Micro streaming int8 models, tens of KB.

## Current state (slice 2, issue #185)

The full streaming driver ships (`wake_kws_microwakeword_ops`) behind
`WAKE_SDK_MICROWAKEWORD_HAS_RUNTIME` (default OFF; the OFF build still
compiles, registers, and warmups — see the L1 contract face):

- **Frontend:** microfrontend C library (30 ms window, 10 ms step,
  40 channels, 125–7500 Hz, noise reduction + PCAN + log) with the exact
  training-time parameters (`preprocessor_settings.h` + `setup()` from
  ESPHome's `micro_wake_word` component, verified against the upstream
  `micro-wake-word` training preprocessor).
- **Features:** integer pipeline verbatim from ESPHome
  `generate_features_()`: `((u16 * 256) + 333) / 666 - 128`, clamped int8.
- **Inference:** `MicroInterpreter` over the streaming int8 graph (13 ops:
  Concatenation, Conv2D, FullyConnected, Logistic, Mul, Add, Reshape,
  StridedSlice, Quantize, CallOnce, VarHandle, ReadVariable,
  AssignVariable); stream state rides resource variables across invokes.
  Output uint8 → posterior `q / 255` (`inference.py` dequant).
- **Arenas:** static 64 KB tensor arena (measured `arena_used_bytes()` =
  54384 on okay_nabu) + 8 KB variable arena; no heap except the model
  bytes, the interpreter object, and the frontend's own buffers at load().
- **L1:** two-face test (`device/tests/unit/microwakeword.test.cxx`) —
  no-runtime contract plus real inference over okay_nabu (warmup, finite
  [0,1] posteriors, warmup-again after reset). Verified host-side:
  2096/2096 assertions.

## Next step (slice 3: CI, not this commit)

Slices 1 (fetch + pins) and 2 (driver + L1) are done and verified
host-side. Remaining for #185 acceptance:

1. **CI job** (`device.yml` `app-runtime-microwakeword`, following the
   `app-runtime-*` pattern): fetch runtime + model, configure with
   `-DWAKE_SDK_MICROWAKEWORD_HAS_RUNTIME=ON` +
   `-DWAKE_MICROWAKEWORD_MODEL_DIR`, build, run ctest. (No cmake on the
   dev machine — the CMake file is reviewed but CI-proven only.)
2. **Trigger-clip validation:** the L1 asserts finite posteriors on
   non-target audio; a real "okay nabu" clip asserting an actual trigger
   (issue acceptance) needs a recorded clip staged like sherpa's
   `trigger.wav`.
3. **`docs/modules/sdk.md`** driver-section status line once CI is green.
