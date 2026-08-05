# RNNoise module - device target (C/C++)

Pulled into the top-level `device/` CMake build tree via `add_subdirectory`
(ADR-025). RNNoise ships as portable C (`xiph/rnnoise`); this directory will
wrap it for the device-side SDK (`@wake-studio/sdk-afe`, ADR-021).

Planned:
- `CMakeLists.txt` - builds rnnoise.c + a thin `wake_rnnoise.h` facade
- `wake_rnnoise.c/h` - frame-in/out + VAD, mirroring `core/engine.ts`

Not yet implemented (pilot scope: web + node + train; device is Phase 4).
