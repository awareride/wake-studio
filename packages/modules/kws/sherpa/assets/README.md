# sherpa-onnx KWS assets

This directory holds the sherpa-onnx KWS WebAssembly runtime (the ~53 MB
bundle) **at runtime only** - it is gitignored (ADR-011) and never committed.

The wasm glue + `.wasm` + `.data` are produced by the generic build workflow
(`.github/workflows/build.yaml` + `scripts/build-module.mjs kws-sherpa`,
ADR-027 §6.7) and published as the `sherpa-onnx-kws-wasm` artifact.

The build pins sherpa-onnx **master** (default `sherpa_version` input) - NOT
a release tag - because upstream commit `dcf56735` (#3836, 2026-08-04)
removed WebAssembly pthread support, producing a single-threaded wasm that
boots without COEP/SAB (the v1.13.4 release still ships a pthread build that
hangs in browsers without cross-origin isolation). The bundled model is the
latest bilingual one, `sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20`
(default `kws_model` input), with ppinyin `tokens @label` keywords.

## Fetch locally (dev / preview)

```bash
# generic path (reads the module spec's build.artifactName):
node scripts/fetch-artifact.mjs kws-sherpa
```

Or point at an already-downloaded artifact dir:

```bash
node scripts/fetch-artifact.mjs kws-sherpa --from /path/to/artifact
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
