# Data Sources (Audio Generation & Datasets) - Module Specification

- **Status:** Draft (stub - to be filled at Phase 5 start, per the docs-first rule)
- **Owner:** WakeStudio team
- **Plan phase:** Phase 5
- **Related ADRs:** ADR-022 (data-source layer), ADR-013 (training backends),
  ADR-023 (Colab backend)
- **Depends on (modules):** Training (consumes data), Export (license provenance)
- **Last updated:** 2026-07-27

## 1. Purpose

Training-data sourcing is a **pluggable data-source layer** with in-app endpoint
configuration (ADR-022). It provides the audio a wake-word model is trained on:
**platform pre-built resources** (public datasets, project-organized datasets)
and **auto-generated spoken audio samples**. Audio generation **does not run
inside WASM**; it runs in the selected training backend (Self-hosted Service,
Cloud Provider, or Colab - ADR-013 amendment) or is fetched from configured
endpoints. This module is what makes "train a custom wake word from a phrase"
possible without the user hand-collecting audio.

> This is a **stub**. The full contract is written just-in-time at Phase 5 start
> (plan §11). Recorded now so ADR-022 has a concrete document home.

## 2. Scope & boundaries

- **In scope:**
  - A common **data-source interface** (list/fetch/generate) consumed by the
    Training module.
  - Three pluggable source kinds, configurable in-app:
    1. **Local services** (e.g. a local TTS / generation service the user runs).
    2. **Project server APIs** (WakeStudio-provided dataset/generation endpoints).
    3. **General public TTS online endpoints** (user-configurable URLs).
  - Platform pre-built resources: public datasets and project-organized datasets
    (with license provenance tracked per source).
  - Mixing generated audio with dataset negatives/augmentation for training.
- **Out of scope:**
  - Model training itself (Training module / Phase 5 backends).
  - In-browser WASM generation (explicitly excluded by ADR-022).
  - The live AFE/KWS pipeline (AFE/KWS modules).
- **Public surface:** the data-source descriptor + interface, the in-app endpoint
  configuration UI contract, and the per-source license/provenance record.

## 3. Dependencies

- **Upstream (consumes from):** configured endpoints (studio-backend / project API
  / public TTS); platform dataset catalog.
- **Downstream (provides to):** Training module (Phase 5) feeds generated/fetched
  audio into the selected backend's training pipeline.
- **External libraries / models:** Piper TTS (GPL-3.0 active / MIT archived - see
  `LICENSES.md`), `piper-sample-generator` (MIT, training-time only). Generation
  runs in the backend, not in the browser, so copyleft does not infect exported
  device bundles. Generated audio owned by the user feeds commercially-ownable
  models.

## 4. Public API & types

_To be specified at Phase 5 start._ Will define at minimum:

- A `DataSource` descriptor (kind, endpoint/config, license, commercial-use flag).
- The generate/fetch interface returning audio + metadata.
- The endpoint-configuration schema persisted in-app (ADR-017 config panel).

## 5. Data flow / sequence

_To be specified._ High level: user configures sources in-app -> Training module
requests positive/negative audio -> data-source layer generates (via backend) or
fetches (via endpoint) -> audio + provenance returned -> backend trains -> model
artifact.

## 6. Configuration & constants

_To be specified._ Surfaced via `describeParameters()` (ADR-017): endpoint URLs,
TTS voice selection, sample counts, augmentation flags, per-source license tags.

## 7. Error model & failure modes

_To be specified._ Will cover endpoint unreachable / auth failure / generation
timeout, with fallback across configured sources. Per the standing ops rule, the
agent asks the human on asset/download failures rather than getting stuck.

## 8. Observability

_To be specified._ Generation progress, per-source counts, and license/provenance
log shown in-app before export.

## 9. Testing strategy

_To be specified._ Fixture-based tests for the interface; backend integration
tested via the Self-hosted/Colab backends.

## 10. Security & privacy

- Endpoint credentials (if any) are held client-side only, never logged or
  exported (ADR-013 security note).
- Generated audio provenance is recorded so the export license gate (Phase 4) can
  verify commercial usability.

## 11. Open questions

- `[Q-DS-1]` Canonical default public-TTS endpoint(s) to ship pre-configured
  (resolved at Phase 5 start).
- `[Q-DS-2]` Whether project server APIs are WakeStudio-hosted or
  community/self-hosted (resolved at Phase 5 start).

## 12. References

- ADR-022 (this layer), ADR-013 (training backends), ADR-023 (Colab).
- Plan Phase 5, §5.1.
- `docs/modules/training.md` (Phase 5), `LICENSES.md` (Piper/data licenses).

## 13. Change log

| Date | Change | Author |
|---|---|---|
| 2026-07-27 | Initial stub (ADR-022 recorded; full contract deferred to Phase 5 start). | WakeStudio team |
