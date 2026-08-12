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
  epochs, augment, quantize), `train`/`export` actions, the panel surface, and
  the **Colab results importer** (`importColabBundle`) that pulls a trained
  bundle back into the PWA for in-browser test + export (issue #97).
- **Out of scope (Phase 5):** backend execution. The panel is spec-driven and
  holds local controller state; `runAction('train')`/`runAction('export')`
  are stubs until the backend + export kits land.

## Layout

```
core/    training types + job facade + artifact-bundle importer (manifest.ts)
web/     spec-driven panel (renderPanel, ADR-025 §3) + Colab import UI
spec/    module.spec.json
tests/   L1 unit tests (validateBundle + importColabBundle)
```

## Import Colab results (issue #97)

`importColabBundle(file)` parses the zip the module-owned Colab notebook
(`packages/modules/kws/openwakeword/train/colab/train.ipynb`, ADR-035)
produces, validates `metadata.json` + `provenance.json`, and returns an
`ArtifactBundle`. Errors are typed (`BundleImportError.code`) so the UI can
show exactly what is missing (job id / backend≠colab / provenance license /
model). See `docs/modules/training.md` §7.1 for the flow, registration and
the app-side Training view.

## Train scripts

Module train scripts run via `uv` (ADR-028) when a real training path lands;
the contract is declared in `spec/module.spec.json` `train`.

## Docs

- [`docs/modules/training.md`](../../../docs/modules/training.md) — training
  integration contract (ADR-013/023/031).
