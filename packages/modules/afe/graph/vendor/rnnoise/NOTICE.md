# RNNoise WASM (vendored prebuilt)

- **Source package:** `@timephy/rnnoise-wasm@1.0.0`
  (https://github.com/timephy/rnnoise-wasm)
- **Upstream license:** Apache-2.0 - see `./LICENSE`. Originally forked from
  `@jitsi/rnnoise-wasm` (MIT); the RNNoise C core is BSD-3-Clause
  (https://gitlab.xiph.org/xiph/rnnoise).
- **What is vendored:** the prebuilt JavaScript distribution (`dist/`), copied
  verbatim. The WebAssembly binary is **embedded as a base64 data URI** inside
  `generated/rnnoise-sync.js` and compiled synchronously via
  `WebAssembly.Module` - this is required because `AudioWorklet.addModule()`
  does not await promises, so the WASM must be ready synchronously at worklet
  init.
- **Files kept (low-level path used by the single pipeline worklet, ADR-016):**
  - `generated/rnnoise-sync.js` - emscripten sync loader + embedded WASM.
  - `RnnoiseProcessor.js` - frame-by-frame RNNoise wrapper (`processAudioFrame`,
    480 samples, returns a VAD score).
  - `polyfills.js` - `atob` + `self.location.href` shims needed by the emscripten
    glue inside `AudioWorkletGlobalScope`.
- **Type declarations:** minimal local `.d.ts` files are shipped alongside (not
  the upstream ones, to avoid a dependency on `@types/emscripten` /
  `@types/audioworklet`).
- **Reason for vendoring:** WakeStudio ADR-016 - prebuilt WASM is pre-downloaded
  into the repo (deterministic, offline-capable, no runtime fetch).
- See `../../../../LICENSES.md` for the project-wide license matrix.
