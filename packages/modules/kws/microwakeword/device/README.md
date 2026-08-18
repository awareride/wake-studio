# microwakeword module — device target

`micro-wake-word` (OHF-Voice, Apache-2.0) is the **MCU-tier primary backend**
(ADR-019/020): TFLite-Micro streaming int8 models, tens of KB.

## Current state (this commit)

The full C `KWSBackend` adapter shape ships (`wake_kws_microwakeword_ops`):
create / load(model_dir) / process_frame / reset / destroy, plus the CMake
target and the runtime-gating option `WAKE_SDK_MICROWAKEWORD_HAS_RUNTIME`
(default OFF).

Without the runtime the module still compiles, registers, and appears in
capabilities; `load()` returns a clear "runtime not linked" error and
`process_frame()` stays in warmup (`-1`).

## Next step (follow-up, not this commit)

Integrate the pinned TFLite-Micro runtime:

1. Vendor `tensorflow/tflite-micro` (pinned commit) into
   `third_party/tflite-micro` (ADR-037 pristine-import pattern) with the
   upstream build flags (armcc/armclang or the TFLM cmake options).
2. Wire the interpreter under `WAKE_SDK_MICROWAKEWORD_HAS_RUNTIME`: load
   `<model_dir>/microwakeword.tflite`, run one inference per 10 ms frame,
   map the streaming output to the `[0,1]` posterior.
3. Asset recipe (ADR-027): int8 tflite fetched via `scripts/fetch-artifact.mjs`
   (issue #185 acceptance).
4. L1 test: tiny int8 model → finite posterior (native build).

Why not in this commit: TFLite-Micro is a large pinned dependency with its
own build system; the architecture milestone (core + harness + profiles +
bindings) is validated first, per ADR-040 §6 sequencing.
