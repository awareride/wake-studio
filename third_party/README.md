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

Compatibility changes — environment pins and code-level patches — on top of
of the pristine import, newest first. Per **ADR-038** the vendored tree is an
explicit maintained fork: pristine import + the two TF >= 2.16 compat
patches, run on the pinned TF 2.15.1 (Keras-2) line. The vendored code is
never restyled.

| Date | Change | Why | Where the pin lives |
|---|---|---|---|
| 2026-08-18 | **pydot added to the `tf` extra (plot_model deps, #170).** The upstream accuracy test calls `tf.keras.utils.plot_model` unconditionally; it needs `pydot` (pip) + `graphviz` (system binary - provisioned on the backend, e.g. `apt-get install graphviz` on Colab). | upstream `train/test.py` plot_model | module `pyproject.toml` (`tf` extra: `pydot>=1.4`) + backend system dep |
| 2026-08-18 | **TF strategy decision — keep patched upstream on pinned TF 2.15.1, drift-guarded (#170, ADR-038).** Chose the minimal coherent strategy: keep main's vendored tree (pristine import + the two TF >= 2.16 compat patches `2fad2cf`/`bfda6ec`) and main's env (`tensorflow[and-cuda]==2.15.1`, `numpy==1.26.4`, `protobuf==3.20.3`, `tfmot==0.7.5`, `tfa==0.23.0`, Python 3.11) — proven to install and train — and add a **TF drift guard** to the train adapter: it fails loudly if the runtime TF drifts from the declared 2.15 line (no silent divergence). Alternatives rejected: pristine (falsified: `tf._keras_internal` via `tensorflow.compat.v2` absent even on 2.15.1); B-keras3 (~14 files + ~48-file `keras.backend` risk + QAT/`novograd` loss); B-legacy 2.16 modernization (unneeded churn — tfa 0.23.0 cp311-only, tfmot 0.7.5 vs Keras 3). | ADR-038; module `pyproject.toml` (`tf` extra); `train_adapter.py` drift guard |
| 2026-08-17 | **TF env pin for real training (#159).** The upstream is 2020-era: Keras 2 (`tf.keras.backend.set_session` / `set_learning_phase` in `train/train.py`, removed in Keras 3 / TF 2.16+) and `tf.compat.v1` sessions. Pin `tensorflow==2.15.1` (last Keras-2 line), `numpy==1.26.4`, `protobuf==3.20.3`, `absl-py>=1.4` on Python 3.10/3.11. `engine=direct` registry jobs run with the service's python, so the extra lives on the service: `studio-backend[tf]`; the Colab launcher notebook installs `studio-backend[tf,tts]`. No vendored code changed - the pin is purely environmental. | upstream Keras-2/`compat.v1` API surface | `apps/studio-backend/pyproject.toml` (`tf` extra), Colab notebook (`backend-notebook.ts`) |
| 2026-08-17 | **`tensorflow-model-optimization==0.7.5` added to the module `tf` extra** (found by the first real Colab run). The upstream's quantize layers + `spectrogram_augment` (imported by every streamable model incl. `ds_tc_resnet`) import `tfmot` unguarded; it was missing from the env. Environmental only - no vendored-code change. | upstream `layers/quantize.py`, `layers/spectrogram_augment.py` import `tensorflow_model_optimization` | `packages/modules/kws/streaming/train/pyproject.toml` (`tf` extra) |
| 2026-08-17 | **Training env moved into the module (#159, human decision).** The studio-backend must not depend on module train deps: kws-streaming registry entry switches `engine: direct -> uv` with `extras: [tf, tts]`, so jobs run in the module's own uv env (ADR-028 canonical model). The module pyproject now owns the `tf` + `tts` extras and depends on `studio-backend` (git) for `wake_train_kit.data_sources`; the backend's `tf`/`tts` extras were removed (backend stays generic). Registry `uv` engine gained `--extra` support. `UPSTREAM_PYTHON` now correctly defaults to the module venv python (has TF). | module env is the runner under `engine: uv` (ADR-028) | module `pyproject.toml` (`tf`/`tts` extras + git dep), `registry.json` (`engine: uv`) |
| 2026-08-17 | **Generic module staging in the service (#159, human decision).** The Colab notebook no longer knows module names: the service bundles the registry (hatch force-include) and stages each registered module's assets from the repo tarball on demand (`ModuleStager`, `staged_dir`), driven by the job's `moduleId` + each entry's `stage` spec (paths/cwd/env, e.g. `UPSTREAM_DIR` -> staged `third_party`). dry-run + kws-streaming have stage specs; the notebook just installs the service + starts the tunnel. | generic runtimes have no repo checkout; the service provisions registered modules | `registry.py` (`ModuleStager`), `registry.json` (`stage` specs), `backend-notebook.ts` (generic) |
| 2026-08-17 | **Module uv env pinned to Python 3.11** (found by the first real Colab run, job `real-run-1`). Colab's system CPython is 3.12; `tensorflow==2.15.1` only ships cp311 wheels, so the uv engine failed at env creation ("doesn't have a wheel for the current platform"). Fix: `.python-version` = 3.11 in the module train dir - uv provisions a managed CPython 3.11 automatically. Environmental only. | TF 2.15.1 wheel ABI (cp311) vs Colab Python 3.12 | `packages/modules/kws/streaming/train/.python-version` |
| 2026-08-17 | **`tensorflow[and-cuda]==2.15.1` in the module `tf` extra (GPU first, #159).** Colab ships CUDA 12.8 while plain TF 2.15 links CUDA 12.2 - without the pip-managed CUDA libs TF silently falls back to CPU on the T4. The `and-cuda` extra bundles the matching nvidia wheels (linux-only markers; dev machines unaffected). | GPU support in the Colab runtime | module `pyproject.toml` (`tf` extra) |
| 2026-08-17 | **One pinned revision for notebook + wheel + staging (#159, option A/A').** The wheel bakes the source git revision at build time (hatch hook -> `_revision.py`); staging fetches the repo tarball from the GitHub API endpoint at that revision, so the installed service and the staged module code can never drift (falls back to `main` without git metadata). The PWA resolves the latest main SHA when generating the Colab notebook (GitHub API, `main` fallback) and pins the pip install to it - one commit for the notebook you download, the service it installs, and the code it stages. *Later simplified (#163 follow-ups): the notebook form exposes `REVISION` (default `main`) + `STAGING_REVISION` (default = follow `REVISION`) instead of download-time SHA seeding.* | main is a moving target; reproducibility + wheel/staged consistency | `hatch_build.py` + `pyproject.toml` (hook), `staging.py` (`baked_revision`/`staging_revision`), `backend-notebook.ts` (form) |
