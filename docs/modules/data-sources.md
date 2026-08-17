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
  `LICENSES.md`), `piper-sample-generator` (MIT, training-time only), and
  **edge-tts** (MIT, Microsoft Edge TTS client; used for multi-language synthesis
  via the studio-backend `tts` extra). Generation runs in the backend, not in the
  browser, so copyleft does not infect exported device bundles. Generated audio
  owned by the user feeds commercially-ownable models.

## 4. Public API & types

The layer is implemented in `apps/studio-backend/src/wake_train_kit/data_sources.py`
(training-time only; never imported by the browser). It exposes:

- `prepare_speech_commands_v2(data_dir, reporter) -> (root, provenance)` —
  download + extract Speech Commands V2 (CC BY 4.0).
- `prepare_user_archive(url, data_dir, reporter) -> (root, provenance)` —
  download + extract a user-provided `.tar.gz`/`.tgz`/`.tar`/`.zip` archive.
- `build_edge_tts_kws_dataset(phrases, languages, out_dir, ...) -> provenance` —
  multi-language wake-word positives + "unknown" negatives + `_background_noise_`
  silence clips, arranged as a `label/*.wav` tree.
- Lower-level helpers: `download_file`, `extract_archive`, `find_data_root`,
  `synthesize`, `mp3_to_wav`, `write_silence_wav`.

Each source returns a **provenance** dict (name/license/source/commercialUse)
recorded into the bundle's `provenance.json` — the Phase 4 license-gate input.

## 5. Data flow / sequence

1. The user picks a data source in the module's train params
   (`spec.train.params.dataSource`: `speech-commands-v2` | `user-url` |
   `edge-tts` | `local-dir`).
2. The module's train adapter calls the matching helper, which downloads /
   synthesizes a `label/*.wav` tree (plus `_background_noise_`).
3. The adapter runs the upstream trainer on that tree (`--wanted_words` = the
   wake-word folder(s); everything else folds into `_unknown_`).
4. The adapter writes the returned provenance into `provenance.json` and the
   model/metrics into the standard artifact bundle.

## 6. Configuration & constants

_To be specified._ Surfaced via `describeParameters()` (ADR-017): endpoint URLs,
TTS voice selection, sample counts, augmentation flags, per-source license tags.

## 7. Error model & failure modes

- `DataSourceError` on an unsupported archive type, a missing `dataUrl`, a
  missing `edge-tts` install, or a missing `ffmpeg` (edge-tts emits mp3; ffmpeg
  converts to 16 kHz WAV).
- `find_data_root` raises when no `label/*.wav` tree is found after extraction.
- Network downloads stream with heartbeats; a failure surfaces as an
  `error` NDJSON event from the adapter (the job is marked `failed`).

## 8. Observability

_To be specified._ Generation progress, per-source counts, and license/provenance
log shown in-app before export.

## 9. Testing strategy

`apps/studio-backend/tests/test_data_sources.py`: archive extraction + root
finding, `file://` downloads (no network), and a monkeypatched edge-tts run that
asserts the label-tree layout + provenance. Adapter-level coverage lives in
`packages/modules/kws/streaming/train/tests/` (fake upstream, no GPU/network).

## 10. Security & privacy

- Endpoint credentials (if any) are held client-side only, never logged or
  exported (ADR-013 security note).
- Generated audio provenance is recorded so the export license gate (Phase 4) can
  verify commercial usability.

## 11. Open questions

- `[Q-DS-1]` Canonical default public-TTS endpoint(s) to ship pre-configured
  — *answered (2026-08-14):* **edge-tts** is the default multi-language TTS
  path (studio-backend `tts` extra); Speech Commands V2 (CC BY 4.0) is the
  default corpus. Piper remains an option for the openwakeword path.
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
| 2026-08-14 | **Data-source layer shipped (#152):** `wake_train_kit/data_sources.py` with Speech Commands V2 download (CC BY 4.0), user-URL archives, and multi-language edge-tts synthesis; provenance records per source; deterministic backend tests. Q-DS-1 answered. | agent |
