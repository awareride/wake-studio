# afe-aec — AEC stage

Acoustic Echo Cancellation front-end stage (ADR-001, ADR-016). v1 is a
**passthrough**; WebRTC AEC3 integration is deferred to v1.x.

| | |
|---|---|
| Category | `afe` |
| Maturity | `draft` |
| License | MIT (integration) |
| Engine | `AecStage` |
| Spec | [`spec/module.spec.json`](spec/module.spec.json) |

## Purpose

Removes loudspeaker/echo feedback from the microphone signal as the first
stage of the far-field pipeline `AEC -> BSS -> NS -> KWS`.

## Scope

- **In scope:** the stage contract (`AFEStage`), a single `bypass` parameter,
  and passthrough behavior for v1.
- **Out of scope:** a real echo-canceller (WebRTC AEC3 lands in v1.x), audio
  capture, and the orchestration (see `afe-graph`).

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
