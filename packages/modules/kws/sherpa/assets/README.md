# sherpa-onnx KWS assets

This directory holds the sherpa-onnx KWS WebAssembly runtime (the ~53 MB
bundle) **at runtime only** - it is gitignored (ADR-011) and never committed.

The wasm glue + `.wasm` + `.data` are produced by the generic build workflow
(`.github/workflows/build.yaml` + `scripts/build-module.mjs kws-sherpa`,
ADR-027 §6.7) and published as the `sherpa-onnx-kws-wasm` artifact.

## Fetch locally (dev / preview)

```bash
# generic path (reads the module spec's build.artifactName):
node scripts/fetch-artifact.mjs kws-sherpa

# or the legacy convenience script (same target dir):
pnpm --filter @wake-studio/web fetch-sherpa-kws-assets
```

Or point at an already-downloaded artifact dir:

```bash
KWS_WASM_ARTIFACT_DIR=/path/to/artifact node scripts/fetch-artifact.mjs kws-sherpa
```

Expected files:

```
sherpa-onnx-wasm-kws-main.js
sherpa-onnx-wasm-kws-main.wasm
sherpa-onnx-wasm-kws-main.data
sherpa-onnx-kws.js
```

Served in dev at `/modules/kws/sherpa/assets/sherpa-onnx-kws/...` (vite
middleware, ADR-025).
