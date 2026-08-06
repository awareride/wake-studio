# kws-sherpa — sherpa-onnx KWS driver

ASR-Decoding KWS driver wrapping a [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx)
`KeywordSpotter` (streaming transducer) compiled to WASM (ADR-020/024). Runs on
the **main thread** (the classic emscripten build needs a DOM).

| | |
|---|---|
| Category | `kws` |
| Maturity | `draft` |
| License | Apache-2.0 (sherpa-onnx) + MIT (integration) |
| Engine | `SherpaOnnxKwsBackend` (main thread) |
| Wasm | `/modules/kws/sherpa/assets/sherpa-onnx-kws/` |
| Spec | [`spec/module.spec.json`](spec/module.spec.json) |

## Purpose

Direct keyword spotting with a fixed wake-word list. The transducer model graph
+ tokens are prebuilt into the wasm `.data` bundle; the driver supplies the
keyword list (`keywords` param, owned by this spec) and points the loader at
the wasm glue.

## Features

- Streaming `KeywordSpotter`: `acceptWaveform` → decode → `getResult`.
- Keywords declared in the spec (`params.keywords`), one per line
  (`spaced tokens :score #threshold @label`); default matches the keywords
  prebuilt into the wasm bundle.
- Main-thread backend factory (DOM-dependent; ADR-024 decoupling).

## Layout

```
assets/  sherpa-onnx-kws.{js,wasm,data} (gitignored, ~53 MB, ADR-011)
core/    SherpaOnnxKwsBackend + wasm boot glue
scripts/ build-sherpa-kws.mjs (CI artifact, ADR-027)
web/     playground entry
spec/    module.spec.json
tests/   L1 unit tests
```

## Assets

Fetch with `node scripts/fetch-artifact.mjs kws-sherpa` (ADR-027); see
[`assets/README.md`](assets/README.md).

## Docs

- [`docs/modules/kws.md`](../../../../docs/modules/kws.md) — KWS module
  specification (ADR-020/024/030).
- [`docs/kws-categories.md`](../../../../docs/kws-categories.md) — KWS
  functional categories (ADR-024).
