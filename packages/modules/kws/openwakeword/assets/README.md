# kws-openwakeword assets

Browser-ready openWakeWord model files for the OpenWakeWord KWS driver
(melspectrogram -> speech_embedding -> classifier pipeline).

## What lives here

`openWakeWord/` mirrors the upstream `dscripka/openWakeWord` release files
used by this module:

- `melspectrogram.onnx` / `.tflite` — 16 kHz log-Mel front-end (Apache-2.0).
- `embedding_model.onnx` / `.tflite` — Google speech_embedding backbone
  re-implemented in openWakeWord (Apache-2.0, ~1.4M params).
- `silero_vad.onnx` — Silero VAD (MIT; gating candidate, ADR-018).
- `alexa_v0.1`, `hey_jarvis_v0.1`, `hey_mycroft_v0.1`, `hey_rhasspy_v0.1`,
  `timer_v0.1`, `weather_v0.1` (`.onnx` + `.tflite`) — openWakeWord demo
  classifiers (CC BY-NC-SA; demo-only, NOT commercially clean).

The files are **gitignored** (ADR-011) and are NOT CI-built — they are copied
once from the upstream release (see `spec/module.spec.json` `build.notes`).
They are served at `/modules/kws/openwakeword/assets/openWakeWord/...`
(vite middleware in dev, `copyModuleAssets` into dist for deploy; ADR-025).

## Where the app points

The registry (`apps/web/public/model-registry.json`) entries `melspectrogram`,
`speech_embedding` and `silero-vad` reference these paths. The KWS panel
(`apps/web/src/components/KWSPanel.tsx`) hard-codes the first two for the
OpenWakeWord backend. The classifier stays remote (hey-buddy, CC-BY-4.0,
commercially clean - ADR-018 Q-KWS-1).

## Regenerating

Re-copy from the upstream openWakeWord release if needed, keeping the same
filenames so the registry / panel URLs stay valid.
