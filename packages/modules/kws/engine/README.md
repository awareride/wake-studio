# kws-engine — KWS engine

The pluggable keyword-spotting detection loop (ADR-020). Owns the generic
per-frame pipeline — VAD gate, score smoothing, trigger detection, threading —
and dispatches inference to registered `KWSBackend` drivers.

| | |
|---|---|
| Category | `kws` |
| Maturity | `pilot` |
| License | MIT (integration) |
| Engine | `KWSEngine` (runs in a Web Worker) |
| Spec | [`spec/module.spec.json`](spec/module.spec.json) |

## Purpose

Detects the wake word on the processed AFE stream and raises a trigger event.
The engine is backend-agnostic: driver modules (openwakeword, sherpa, plix)
register themselves into the backend registry (ADR-024 decoupling).

## Features

- `KWSBackend` registry: `registerKwsBackend` / `getBackendRegistry` /
  `createBackend`.
- Main-thread backend path for DOM-dependent drivers (e.g. sherpa-onnx-kws).
- Generic detection loop: VAD gate, `ScoreSmoother`, `TriggerDetector`,
  cooldown.
- Config surface (`describeParameters`): threshold, min duration, smoothing,
  VAD gate/threshold, cooldown, execution provider (WebGPU/WASM).

## Layout

```
core/    KWSEngine, backend registry, defaults, types
web/     worker + main-thread wiring, playground entry
spec/    module.spec.json
tests/   L1 unit tests
```

## Driver modules

| Driver | Category | Engine |
|---|---|---|
| `kws-openwakeword` | Traditional | `OpenWakeWordBackend` |
| `kws-sherpa` | ASR-Decoding | `SherpaOnnxKwsBackend` |
| `kws-plix` | Few-Shot | `PlixKwsEmbedProvider` |

## Docs

- [`docs/modules/kws.md`](../../../../docs/modules/kws.md) — KWS module
  specification (ADR-020/024/030).
- [`docs/kws-categories.md`](../../../../docs/kws-categories.md) — KWS
  functional categories (ADR-024).
