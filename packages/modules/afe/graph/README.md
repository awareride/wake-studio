# afe-graph — AFE pipeline graph

Orchestrates the in-browser far-field front-end **AEC -> BSS -> NS** (ADR-001)
inside a single AudioWorklet, producing a clean 16 kHz mono stream for KWS and
emitting per-stage data for live visualization.

| | |
|---|---|
| Category | `afe` |
| Maturity | `pilot` |
| License | MIT (integration); RNNoise BSD-3 / Apache-2.0 (vendored) |
| Engine | `AFEPipeline` |
| Wasm | RNNoise (`/modules/afe/rnnoise/rnnoise.wasm`, emscripten loader) |
| Spec | [`spec/module.spec.json`](spec/module.spec.json) |

## Purpose

Delivers the first half of the in-browser experience (requirements R1/R5):
microphone capture + the real-time AFE pipeline with per-stage bypass,
latency measurement, and visualization data.

## Features

- Mic capture (`getUserMedia` → `AudioContext` → `AudioWorklet`).
- Pluggable stages behind `AFEStage` (aec/bss/rnnoise); each is bypassable.
- 16 kHz mono output stream consumed by the KWS engine.
- Live viz data per stage, record/replay, end-to-end latency.
- Single-worklet topology for v1 (node-per-stage is a future option).

## Layout

```
core/    AFEPipeline, stage types, defaults/constants (DSP numerics live in @wake-studio/dsp)
web/     wasm/panel wiring, playground entry
spec/    module.spec.json
tests/   L1 unit tests (module's own logic; DSP in @wake-studio/dsp)
```

## Docs

- [`docs/modules/afe.md`](../../../../docs/modules/afe.md) — AFE module
  specification (ADR-016/017/029).
