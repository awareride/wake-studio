# rnnoise — RNNoise Noise Suppression

Noise-suppression (NS) stage backed by the frozen [xiph/rnnoise](https://github.com/xiph/rnnoise)
model, compiled to WASM and run in an AudioWorklet (ADR-002: we integrate, we
do not invent models).

| | |
|---|---|
| Category | `afe` |
| Maturity | `pilot` |
| License | BSD-3-Clause (RNNoise) + MIT (integration) |
| Engine | `RnnoiseModule` |
| Wasm | `/modules/rnnoise/rnnoise.wasm` (emscripten loader) |
| Spec | [`spec/module.spec.json`](spec/module.spec.json) |

## Purpose

Spectral post-filter that suppresses stationary/non-stationary noise, and the
source of the v1 VAD probability used to gate KWS (ADR-018).

## Layout

```
assets/  prebuilt rnnoise.wasm (vendored, gitignored binary)
core/    constants/VAD mapping + module facade (DSP numerics in @wake-studio/dsp)
web/     wasm loader + spec-driven playground
device/  device-side RNNoise (C) integration kit
train/   train contract (frozen model; no training, ADR-028)
node/    native/subprocess impl for the studio-backend
spec/    module.spec.json
tests/   L1 unit tests
```

## Assets

The prebuilt wasm is **vendored** (not CI-built); see
[`assets/README.md`](assets/README.md).

## Docs

- [`docs/modules/afe.md`](../../../../docs/modules/afe.md) — AFE module
  specification (ADR-016/017/029).
- [`train/README.md`](train/README.md) — the (frozen) train contract.
- [`device/README.md`](device/README.md) — device-side integration kit.
