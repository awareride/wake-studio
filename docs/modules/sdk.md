# Device-Side SDK - Module Specification

- **Status:** Draft (stub - to be filled at Phase 4 start, per the docs-first rule)
- **Owner:** WakeStudio team
- **Plan phase:** Phase 4 (reshaped by ADR-021)
- **Related ADRs:** ADR-019 (target matrix), ADR-020 (pluggable KWS backends),
  ADR-021 (device-side SDK), ADR-003 (vendor vs portable AFE), ADR-016 (AFE
  design)
- **Depends on (modules):** KWS (KWSBackend interface), AFE (portable RNNoise/
  WebRTC core), Export (bundle generation)
- **Last updated:** 2026-07-27

## 1. Purpose

WakeStudio develops a **layered portable device-side SDK**, and **every export
workflow is built upon it** (ADR-021). The SDK is the shared substrate that lets
WakeStudio emit application templates for the full target matrix (ADR-019) - Arm
Cortex-M (STM32, Arduino), Raspberry Pi, Android, iOS, browsers, and desktop
(Linux/macOS/Windows) - without maintaining N divergent codepaths. The in-browser
PWA demo also consumes the same `KWSBackend` interface (via the JS/WASM binding)
so the demo and the exports stay consistent.

> This is a **stub**. The full contract is written just-in-time at Phase 4 start
> (plan §11), reviewed, and then implemented. It is recorded now so ADR-021 has a
> concrete document home and the Phase 4 reshaping is visible.

## 2. Scope & boundaries

- **In scope:**
  - A target-agnostic **Core (C/C++)**: the `KWSBackend` interface (ADR-020), a
    portable AFE (RNNoise/WebRTC, per ADR-003/016), audio-I/O + threading + clock
    abstractions, and VAD.
  - **Target adapters**: per-platform implementations of the abstractions (audio
    capture, model runtime, threading) for each target in ADR-019.
  - **Language bindings**: JS/WASM (browsers), Kotlin (Android), Swift (iOS),
    Python (Linux/macOS/Windows), C/TFLite-Micro (Cortex-M, ESP32).
  - The **bundle layout** every export emits: SDK adapter + model + AFE config +
    `demo/` + `README.md` + `LICENSES.md` + `test/` (FAR/FRR).
- **Out of scope:**
  - Training (owned by the Training module / Phase 5 + ADR-013 backends).
  - Audio-data sourcing (owned by the Data-Sources module / ADR-022).
  - The PWA UI itself (the Studio), which *uses* the JS/WASM binding but is not
    part of the exported SDK.
- **Public surface:** the `KWSBackend` interface, the AFE/abstraction headers,
  the per-target adapter entry points, and the bundle generator contract.

## 3. Dependencies

- **Upstream (consumes from):** KWS module (`KWSBackend` interface + adapters:
  openWakeWord, micro-wake-word, PLiX Few-Shot, PocketSphinx - ADR-020); AFE
  module (portable NS/AEC cores).
- **Downstream (provides to):** Export module (Phase 4 bundle generation); the
  in-browser PWA demo (JS/WASM binding).
- **External libraries / models:** onnxruntime (Apache-2.0), TFLite-Micro
  (Apache-2.0), RNNoise (BSD-3), WebRTC audio_processing (BSD-3), PocketSphinx
  (BSD). See `LICENSES.md`; per-target `LICENSES.md` applies because vendor/model
  licenses differ.

## 4. Public API & types

_To be specified at Phase 4 start._ The contract will define at minimum:

- The `KWSBackend` interface (load, processFrame, reset, score/threshold
  semantics) shared by the in-browser engine and every exported target.
- The audio-I/O / threading / clock abstraction interface that target adapters
  implement.
- The bundle-generator interface (target -> zip layout).

## 5. Data flow / sequence

_To be specified at Phase 4 start._ High level: `audio capture -> AFE (core) ->
KWSBackend (core) -> trigger`, with all three running on the device via the
target adapter; the PWA demo follows the same path through the JS/WASM binding.

## 6. Configuration & constants

_To be specified._ Will be surfaced via `describeParameters()` (ADR-017),
including per-target frame sizes, sample rate (16 kHz at the KWS boundary),
latency budgets, and the selectable KWS backend + AFE mode per target.

## 7. Error model & failure modes

_To be specified._ Will cover model-load failure, audio-device failure, and
backend-incompatibility (e.g. a backend too large for a target) with graceful
fallback to a lighter backend (ADR-020).

## 8. Observability

_To be specified._ Exposes score/VAD/latency telemetry for the in-app UI and a
serial/log channel in exported demos.

## 9. Testing strategy

_To be specified._ Per-target build smoke tests; FAR/FRR `test/` script in every
bundle; on-hardware validation for golden-path targets.

## 10. Security & privacy

- The SDK processes mic audio on-device; no audio leaves the device in exported
  deployments.
- No credentials are bundled into exported artifacts (ADR-013 security note).

## 11. Open questions

- `[Q-SDK-1]` Concrete `KWSBackend` C interface shape (resolved at Phase 4 start).
- `[Q-SDK-2]` Whether iOS uses ONNX Runtime or Core ML for the PLiX/openWakeWord
  path (resolved at Phase 4 start).
- `[Q-SDK-3]` ESP32 (deferred target, ADR-019) adapter scope vs Cortex-M-first
  sequencing.

## 12. References

- ADR-019 (target matrix), ADR-020 (pluggable KWS backends), ADR-021 (this SDK).
- Plan §6 (target matrix), Phase 4 (reshaped).
- `docs/modules/kws.md`, `docs/modules/afe.md`, `docs/modules/export.md`.

## 13. Change log

| Date | Change | Author |
|---|---|---|
| 2026-07-27 | Initial stub (ADR-021 recorded; full contract deferred to Phase 4 start). | WakeStudio team |
