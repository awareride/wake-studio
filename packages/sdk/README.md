# packages/sdk — SDK binding package (ADR-021 §3, ADR-040 §2)

The SDK's **public binding package**: the C API's language-facing side. The
C/C++ source itself lives in the top-level `device/` tree + each module's
`device/` dir.

## Python binding (ctypes, no compiler)

- `python/wake_sdk/__init__.py` — ctypes binding over `libwake_sdk`
- `python/wake-sdk-demo.py` — demo CLI (wav → scores/triggers, exit 0/1)

Build the shared library first:

```bash
cmake -S device -B build -DCMAKE_BUILD_TYPE=Debug -DWAKE_SDK_PROFILE=app
cmake --build build
```

Then, from the repo root:

```bash
python3 packages/sdk/python/wake-sdk-demo.py tone.wav --threshold 0.5
```

`wake_sdk.find_library()` searches `build/libwake_sdk.{so,dylib}` and
`WAKE_SDK_LIB`. The binding exposes the same pipeline the CLI demo and the
browser use (AFE graph → KWS backend → detection loop).

## Roadmap (not yet implemented)

- JS/WASM binding (browsers, emscripten) — reuses the in-app backends
- Kotlin (JNI) / Swift bindings (Android/iOS milestones)
