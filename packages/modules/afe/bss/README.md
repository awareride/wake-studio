# afe-bss — BSS stage

Blind Source Separation front-end stage (ADR-001, ADR-016). v1 is a
**single-mic passthrough**; 2-mic beamforming is a future option.

| | |
|---|---|
| Category | `afe` |
| Maturity | `draft` |
| License | MIT (integration) |
| Engine | `BssStage` |
| Spec | [`spec/module.spec.json`](spec/module.spec.json) |

## Purpose

Separates the target source from a mixture without a known mixing model; the
second stage of the far-field pipeline `AEC -> BSS -> NS -> KWS`.

## Scope

- **In scope:** the stage contract (`AFEStage`), a single `bypass` parameter,
  and passthrough behavior for v1.
- **Out of scope:** real BSS (multi-mic beamforming / ICA is a future
  option), audio capture, and orchestration (see `afe-graph`).

## Layout

```
core/    stage implementation + public exports
spec/    module.spec.json (params, runtime)
tests/   L1 unit tests
```

## Usage

The `afe-graph` module instantiates this stage and drives it in the
AudioWorklet. It is not used standalone from the web app.

## Docs

- [`docs/modules/afe.md`](../../../../docs/modules/afe.md) — AFE module
  specification (ADR-016/017/029).
