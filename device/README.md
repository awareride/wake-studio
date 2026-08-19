# WakeStudio — Device-side SDK (ADR-021 / ADR-040)

Top-level **aggregation tree** for the device-side C/C++ SDK. The SDK core
lives here (`core/`); each module's on-device code lives inside its module
(`packages/modules/<category>/<name>/device/`, per the CONTRIBUTING layout).

```
device/
├── CMakeLists.txt          # aggregation: core + selected module device/ dirs + adapters + tests
├── cmake/sdk-options.cmake # WAKE_SDK_PROFILE=mcu|app (ADR-040 §4)
├── core/                   # target-agnostic C++17 core, C ABI headers in core/include/wake/
├── adapters/               # per-target: host/ (reference), cortex-m/ (later), ...
└── tests/                  # L1 unit + composition-root integration (native harness)
```

## Build (native, host profile)

```bash
cmake -S device -B build -DCMAKE_BUILD_TYPE=Debug -DWAKE_SDK_PROFILE=app
cmake --build build -j
ctest --test-dir build --output-on-failure
```

MCU profile: `-DWAKE_SDK_PROFILE=mcu` (static buffers, no threads, int16 DSP).

### macOS note (this dev machine)

The local CommandLineTools C++ headers are incomplete (only `c++/v1` subdirs,
no `<cstdlib>`), so the default compiler can't find the standard library.
Use the SDK's headers explicitly (both for syntax checks and full builds):

```bash
SDK=$(xcrun --show-sdk-path)
SYSFLAGS="-nostdinc++ -isystem $SDK/usr/include/c++/v1 -isysroot $SDK"
cmake -S device -B build -DCMAKE_BUILD_TYPE=Debug -DWAKE_SDK_PROFILE=app \
  -DCMAKE_C_FLAGS="$SYSFLAGS" -DCMAKE_CXX_FLAGS="$SYSFLAGS" \
  -DCMAKE_EXE_LINKER_FLAGS="-isysroot $SDK"
```

CI (ubuntu) needs none of this — the GitHub Actions jobs are the authoritative
build gate.

## Contract

- `docs/modules/sdk.md` — module spec (Draft v2, the contract)
- `DECISIONS.md` ADR-040 — core language, placement, registration, profiles, CI
- `packages/sdk` — SDK public binding package (JS/WASM binding + bundle tooling)
