# sherpa-onnx assets (ASR-Decoding KWS)

These files power the **ASR-Decoding KWS** backend
(`src/asr/`, docs/kws-categories.md §2.2, ADR-024). They are **not** committed
to git (large binaries) and are fetched on demand.

## What lives here

```
sherpa-onnx/
├── sherpa-onnx-wasm-main-asr.js   # Emscripten glue that boots the WASM
├── sherpa-onnx-wasm-main-asr.wasm # sherpa-onnx runtime (~11 MB)
├── sherpa-onnx-asr.js             # OnlineRecognizer JS wrapper
└── models/asr/
    ├── encoder.onnx
    ├── decoder.onnx
    ├── joiner.onnx
    └── tokens.txt
```

## Fetch them

```bash
node scripts/fetch-sherpa-assets.mjs
```

This downloads the wasm + glue (Apache-2.0, from the k2-fsa/sherpa-onnx GitHub
release) and a default English streaming transducer model into this directory.

## License

- `sherpa-onnx` runtime: **Apache-2.0** (k2-fsa/sherpa-onnx).
- Default model `sherpa-onnx-streaming-zipformer-en-20M-2023-02-17`: **Apache-2.0**.

## Custom models

Point the panel's "ASR model" field (or `AsrDecodeConfig.modelBaseUrl`) at any
sherpa-onnx **streaming transducer/zipformer** model directory that exposes
`encoder.onnx` / `decoder.onnx` / `joiner.onnx` / `tokens.txt`. See
https://github.com/k2-fsa/sherpa-onnx/releases/tag/asr-models.
