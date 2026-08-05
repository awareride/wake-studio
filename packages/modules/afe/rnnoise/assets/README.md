# RNNoise module - assets

Built binary artifacts for this module, served by the web app at
`/modules/afe/rnnoise/assets/...` (ADR-025, apps/web/vite.config.ts
`servePrebuilts`).

**Current state:** the RNNoise wasm is embedded as base64 inside
`web/vendor/generated/rnnoise-sync.js` (synchronous emscripten glue) - it ships
with the module source and needs no separate asset file. This directory is
reserved for when the wasm moves to a standalone artifact built in CI
(ADR-027, `.github/workflows/build-rnnoise-wasm.yml` planned).

Assets are gitignored (ADR-011) and fetched via the module's fetch script when
they exist as separate files.
