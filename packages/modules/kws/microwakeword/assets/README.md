# kws-microwakeword assets

Device-side micro-wake-word model file for the MCU-tier KWS driver
(`device/`, issue #185).

## What lives here

- `okay_nabu.tflite` — microWakeWord demo model ("okay nabu", int8 quantized
  streaming MixConv CNN, 115,400 bytes, Apache-2.0) from
  `esphome/micro-wake-word-models` (`models/okay_nabu.tflite` at pinned ref
  `05b6592`, main @ 2026-09-21). The L1 real-inference model (slice 2) and
  the bundle generator's default MCU model (#189).

The file is **gitignored** (ADR-011) and fetched direct-URL, sha256-verified,
by `node scripts/fetch-tflite-micro.mjs` (the model is not hosted on a
WakeStudio release, so `fetch-artifact.mjs` cannot serve it). Served at
`/modules/kws/microwakeword/assets/okay_nabu.tflite` in dev.

## Registry

The `microwakeword-demo` entry in `spec/models.json` (owned by the
kws-openwakeword fragment until this module gains its own `spec/`) records
the pin (sha256 + sizeBytes); the generated catalog is
`apps/web/public/model-registry.json` (regen with
`node scripts/build-model-registry.mjs --update`).
