# kws-openwakeword assets

Browser-ready openWakeWord model files for the OpenWakeWord KWS driver
(melspectrogram -> speech_embedding -> classifier pipeline).

## What lives here

`openWakeWord/` mirrors the upstream `dscripka/openWakeWord` release files
used by this module, plus the hey-buddy classifier:

- `melspectrogram.onnx` — 16 kHz log-Mel front-end (Apache-2.0).
- `embedding_model.onnx` — Google speech_embedding backbone re-implemented
  in openWakeWord (Apache-2.0, ~1.4M params).
- `silero_vad.onnx` — Silero VAD (MIT; gating candidate, ADR-018).
- `alexa_v0.1`, `hey_jarvis_v0.1`, `hey_mycroft_v0.1`, `hey_rhasspy_v0.1`,
  `timer_v0.1`, `weather_v0.1` (`.onnx`) — openWakeWord demo classifiers
  (CC BY-NC-SA; demo-only, NOT commercially clean).
- `hey-buddy/models/hey-buddy.onnx` — Hey Buddy wake-word classifier
  (CC-BY-4.0, commercially clean; the app's default classifier).

The files are **gitignored** (ADR-011) and fetched from the GitHub Release
`models-openwakeword-v1` (ADR-027; `spec/module.spec.json` `build.fetch`).
Fetch with `pnpm fetch:all` (or `node scripts/fetch-artifact.mjs
kws-openwakeword`). They are served at
`/modules/kws/openwakeword/assets/openWakeWord/...` (vite middleware in dev,
`copyModuleAssets` into dist for deploy; ADR-025).

## Where the app points

The registry (`apps/web/public/model-registry.json`) entries `melspectrogram`,
`speech_embedding`, `silero-vad`, the `openwakeword-*` demo models and
`hey-buddy` reference these paths. The KWS panel renders the backend's
model-source roles from its registration (ADR-024); the defaults are
melspectrogram + embedding + hey-buddy.

## Regenerating

The tarball on the release was staged from these files. To refresh (e.g. a
new upstream openWakeWord release), rebuild the tarball keeping the same
filenames and upload it to the release (`gh release upload
models-openwakeword-v1 <archive> --clobber`) so the registry / panel URLs
stay valid.
