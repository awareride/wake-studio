# RNNoise module - device target (C/C++)

Pulled into the top-level `device/` CMake build tree via `add_subdirectory`
(ADR-025). RNNoise ships as portable C (`xiph/rnnoise`, vendored pinned at
`third_party/rnnoise` v0.1.1); this directory wraps it for the device-side
SDK (`wake_afe_rnnoise` static lib + `wake_afe_ns_ops` AFE stage).

Implemented:
- `CMakeLists.txt` — builds the vendored rnnoise sources + the NS/VAD stage
- `src/ns_stage.c` — AFE NS stage: 160-sample in/out slip buffer around
  RNNoise's 480-sample frames (30 ms latency, streaming, no sample loss),
  mirrors `core/engine.ts` (VAD probability per frame)

The VAD probability rides this stage (browser parity) and feeds the
detection loop's VAD gate (`wake/detection.h`).
