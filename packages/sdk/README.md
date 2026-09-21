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

## Raspberry Pi golden path (#187)

On Raspberry Pi OS (64-bit), the demo runs against the app profile with the
onnxruntime-backed drivers (plix/openwakeword). System packages needed:

```bash
sudo apt install -y python3 alsa-utils
```

Build the shared library (app profile), fetching the pinned aarch64
onnxruntime prebuilt first when a real backend is wanted:

```bash
node scripts/fetch-onnxruntime.mjs   # aarch64 prebuilt, sha256-verified
cmake -S device -B build -DCMAKE_BUILD_TYPE=Release -DWAKE_SDK_PROFILE=app
cmake --build build
```

Without the runtime fetch the drivers still register but `load()` fails
loudly ("runtime not linked") and only the `rms` reference backend triggers —
useful as a plumbing check before downloading anything.

Live mic via the `arecord` raw pipe (no extra Python dependencies):

```bash
arecord -f S16_LE -r16000 -c1 -t raw -D default \
  | python3 packages/sdk/python/wake-sdk-demo.py --stdin \
      --backend openwakeword --model-dir models/
```

WAV fallback (same file the CI smoke uses):

```bash
python3 packages/sdk/python/wake-sdk-demo.py tone.wav --backend rms
```

`--backend` picks any id from `SDK.backend_id_list()`; `--model-dir` points
at the staged driver model files (see the `device.yml` "Stage driver model
dir" steps for the per-driver file names). Exit code is 0 on trigger, 1
otherwise. On-device validation on a real Pi is tracked with #38.

## Roadmap (not yet implemented)

- JS/WASM binding (browsers, emscripten) — reuses the in-app backends
- Kotlin (JNI) / Swift bindings (Android/iOS milestones)
