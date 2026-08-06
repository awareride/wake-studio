# kws-openwakeword — OpenWakeWord KWS driver

Traditional-classification KWS driver wrapping the [openWakeWord](https://github.com/dscripka/openWakeWord)
models (mel-spectrogram → speech-embedding → classifier), run in a Web Worker.

| | |
|---|---|
| Category | `kws` |
| Maturity | `pilot` |
| License | Apache-2.0 (code); pre-trained models CC BY-NC-SA (demo-only) |
| Engine | `OpenWakeWordBackend` (worker) |
| Spec | [`spec/module.spec.json`](spec/module.spec.json) |

## Purpose

Registers the `openwakeword` backend into the KWS engine registry (ADR-020/024).
Loads the mel front-end + embedding backbone + a classifier (demo: hey-buddy,
CC-BY-4.0, commercially clean — ADR-018 Q-KWS-1) and scores each AFE frame.

## Models

Third-party openWakeWord models are copied into `assets/openWakeWord/` from the
upstream release (not CI-built); see [`assets/README.md`](assets/README.md).
Registry entries: `apps/web/public/model-registry.json` (ADR-027).

## Layout

```
assets/  model files (melspectrogram, speech_embedding, silero_vad)
core/    OpenWakeWordBackend
spec/    module.spec.json
tests/   L1 unit tests
```

## Docs

- [`docs/modules/kws.md`](../../../../docs/modules/kws.md) — KWS module
  specification (ADR-020/024/030).
