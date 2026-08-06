# training — Custom wake-word training

Training integration contract for custom wake-word models (ADR-013/023/031).
Declares the job/training surface; backend execution is Phase 5.

| | |
|---|---|
| Category | `training` |
| Maturity | `draft` |
| License | MIT (integration) |
| Engine | `TrainingJob` |
| Spec | [`spec/module.spec.json`](spec/module.spec.json) |

## Purpose

Train a WakeStudio-owned wake-word model on target-domain data (the
commercial-export path; openWakeWord demo models are CC BY-NC-SA and demo-only).

## Scope

- **In scope (contract):** training job params (wake phrase, target, backend,
  epochs, augment, quantize), `train`/`export` actions, and the panel surface.
- **Out of scope (Phase 5):** backend execution. The panel is spec-driven and
  holds local controller state; `runAction('train')` is a stub until the
  backend lands.

## Layout

```
core/    training types + job facade
web/     spec-driven panel (renderPanel, ADR-025 §3)
spec/    module.spec.json
tests/   L1 unit tests
```

## Train scripts

Module train scripts run via `uv` (ADR-028) when a real training path lands;
the contract is declared in `spec/module.spec.json` `train`.

## Docs

- [`docs/modules/training.md`](../../../docs/modules/training.md) — training
  integration contract (ADR-013/023/031).
