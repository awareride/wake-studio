# OpenWakeWord — module-owned Colab training notebook

This directory holds the **module-owned** Colab notebook for the
`kws-openwakeword` module:

```
packages/modules/kws/openwakeword/train/colab/train.ipynb
```

It is advertised to the WakeStudio PWA via `spec.train.notebookLocal` in
`packages/modules/kws/openwakeword/spec/module.spec.json`; the generated panel
renders an **"Open in Colab"** action that opens this notebook directly from
the repo (module-kit `buildColabUrl`, ADR-035).

## What it does

The notebook trains a custom **openWakeWord** wake-word classifier from a
phrase, entirely inside a Google Colab session (no WakeStudio server, no
provider credentials — only the user's Google account):

1. Installs the **pinned upstream** `openWakeWord` training environment and
   the Piper TTS sample-generator (Linux-only; Colab is Linux).
2. Downloads the same public training data as the upstream
   `automatic_model_training` notebook (MIT RIRs, AudioSet, FMA, precomputed
   ACAV100M features, validation feature set).
3. Writes the training YAML config from the notebook's Step 0 parameters.
4. Runs the **upstream `train.py` unchanged** (`--generate_clips`,
   `--augment_clips`, `--train_model`) — we adapt to the script, we never
   rewrite it (`docs/modules/training.md` §4).
5. Normalizes the trained model into the **standard artifact bundle**
   (`docs/modules/training.md` §6) and zips it.
6. The user downloads the zip and imports it back via **"Import Colab
   results"** in the WakeStudio app.

## Manual run steps

1. Open the notebook in Colab:
   `https://colab.research.google.com/github/awareride/wake-studio/blob/main/packages/modules/kws/openwakeword/train/colab/train.ipynb`
2. Edit the **Step 0** cell: set `WAKE_PHRASE` (and optionally
   `N_SAMPLES`, `STEPS`, etc.).
3. Click **Runtime → Run all**. Expected ~1 hour on a free Colab T4 GPU with
   the default (reduced) sample counts. If a training stage fails, re-run that
   cell — `train.py` resumes until the config targets are met.
4. When **Step 5** finishes, download
   `wake-studio-results/<job-id>/wake-studio-results.zip`.
5. In WakeStudio, open the **Training** panel for `kws-openwakeword` and
   **Import Colab results**; pick the zip. The importer validates the manifest
   and registers the model for in-browser test + export.

## Optional keys

The default flow needs no API key. Optional keys (e.g. a Google API key for
Drive import, a public TTS endpoint token) are read from environment
variables (`GOOGLE_API_KEY`, `TTS_ENDPOINT_TOKEN`, …). In WakeStudio, set them
in the **Settings → Security** section (issue #52); they are passed to the
notebook as job params/env and are **never hard-coded** in the committed
notebook (ADR-035, C-7).

## Licensing

The trained classifier is user-owned / commercially clean: `provenance.json`
declares `license: user-owned`, so the Phase 4 export license gate treats it
as exportable (unlike openWakeWord's CC BY-NC-SA pre-trained models, which are
never bundled). Verify the licenses of any dataset/TTS sources you swap in
before commercial deployment.

## Upstream ref pinned

`OPENWAKEWORD_REF = "7607f959"` (C-3) — the openWakeWord commit the notebook
was validated against. Bump deliberately and re-run the notebook to confirm.