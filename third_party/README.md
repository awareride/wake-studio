# third_party - vendored upstream code

Vendored upstream projects that are **dead or archived** upstream, per
ADR-037 (Tier 3 of the integration ladder: pin -> patch -> vendor -> fork).
The upstream repo will never merge fixes, so WakeStudio owns compatibility
on the record instead of pointing at a moving (or frozen) remote.

## Rules (ADR-037 Tier 3)

- The **first commit** of a vendored tree is a **pristine import**: a
  byte-identical copy of the upstream subtree at a pinned SHA, with the
  upstream URL, path, SHA, and license recorded in the commit message.
- All changes land as **separate commits on top** of the pristine import -
  hardening only (dependency pins, modern-Python/runtime compatibility).
- Vendored code is **never linted, reformatted, or refactored**. Keep diffs
  minimal and explain each one in its commit message.
- A `LICENSE` file sits next to the vendored code even when the upstream
  subtree shipped none (the license then comes from the upstream monorepo
  root at the pinned SHA - see the import commit for provenance).
- Repo test runs **never collect** vendored suites: the root `pytest.ini`
  ignores this directory (`--ignore=third_party`).

## Contents

| Directory | Upstream | Imported at | License | Reason |
|---|---|---|---|---|
| `kws_streaming/` | `google-research/google-research` subtree `kws_streaming` | `cf61877d4c0021ff40ec3ecc0334aaa3937a1fcb` (2026-07-22, last commit touching the subtree) | Apache-2.0 | Archived upstream (project-level ARCHIVED); consumed unmodified by the kws-streaming train adapter (ADR-031; #156) |

Import details live in each pristine-import commit message; the policy
itself is ADR-037 in `DECISIONS.md`.

## Hardening log

Compatibility changes on top of the pristine import, newest first. Each entry
is a separate commit on the import; the vendored code is never restyled.

| Date | Change | Why | Where the pin lives |
|---|---|---|---|
| 2026-08-17 | **TF env pin for real training (#159).** The upstream is 2020-era: Keras 2 (`tf.keras.backend.set_session` / `set_learning_phase` in `train/train.py`, removed in Keras 3 / TF 2.16+) and `tf.compat.v1` sessions. Pin `tensorflow==2.15.1` (last Keras-2 line), `numpy==1.26.4`, `protobuf==3.20.3`, `absl-py>=1.4` on Python 3.10/3.11. `engine=direct` registry jobs run with the service's python, so the extra lives on the service: `studio-backend[tf]`; the Colab launcher notebook installs `studio-backend[tf,tts]`. No vendored code changed - the pin is purely environmental. | upstream Keras-2/`compat.v1` API surface | `apps/studio-backend/pyproject.toml` (`tf` extra), Colab notebook (`backend-notebook.ts`) |
| 2026-08-17 | **`tensorflow-model-optimization==0.7.5` added to the module `tf` extra** (found by the first real Colab run). The upstream's quantize layers + `spectrogram_augment` (imported by every streamable model incl. `ds_tc_resnet`) import `tfmot` unguarded; it was missing from the env. Environmental only - no vendored-code change. | upstream `layers/quantize.py`, `layers/spectrogram_augment.py` import `tensorflow_model_optimization` | `packages/modules/kws/streaming/train/pyproject.toml` (`tf` extra) |
| 2026-08-17 | **Training env moved into the module (#159, human decision).** The studio-backend must not depend on module train deps: kws-streaming registry entry switches `engine: direct -> uv` with `extras: [tf, tts]`, so jobs run in the module's own uv env (ADR-028 canonical model). The module pyproject now owns the `tf` + `tts` extras and depends on `studio-backend` (git) for `wake_train_kit.data_sources`; the backend's `tf`/`tts` extras were removed (backend stays generic). Registry `uv` engine gained `--extra` support. `UPSTREAM_PYTHON` now correctly defaults to the module venv python (has TF). | module env is the runner under `engine: uv` (ADR-028) | module `pyproject.toml` (`tf`/`tts` extras + git dep), `registry.json` (`engine: uv`) |
| 2026-08-17 | **Generic module staging in the service (#159, human decision).** The Colab notebook no longer knows module names: the service bundles the registry (hatch force-include) and stages each registered module's assets from the repo tarball on demand (`ModuleStager`, `staged_dir`), driven by the job's `moduleId` + each entry's `stage` spec (paths/cwd/env, e.g. `UPSTREAM_DIR` -> staged `third_party`). dry-run + kws-streaming have stage specs; the notebook just installs the service + starts the tunnel. | generic runtimes have no repo checkout; the service provisions registered modules | `registry.py` (`ModuleStager`), `registry.json` (`stage` specs), `backend-notebook.ts` (generic) |
