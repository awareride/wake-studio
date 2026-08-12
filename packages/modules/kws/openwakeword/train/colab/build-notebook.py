#!/usr/bin/env python3
"""Regenerate the kws-openwakeword Colab training notebook.

Modeled on the upstream openWakeWord `automatic_model_training_simple.ipynb`
(2026-04-11), which the WakeStudio team validated on current Colab (Python
3.11/3.12). That notebook modernized the stack so it runs on Colab's native
Python — NO separate Python 3.10 venv needed:

  - `piper-phonemize-cross` (wheels for modern Python) instead of
    `piper-phonemize`, plus `piper-tts`;
  - `onnx2tf` for TFLite export instead of the broken `onnx_tf` +
    `tensorflow-cpu==2.8.1` path;
  - modern `torch==2.5.0` from the pytorch cu121 index;
  - openwakeword at `main` (upstream default branch), piper-sample-generator
    pinned to `213d4d5`.

The notebook keeps WakeStudio's additions on top: Step 0 params, the standard
artifact bundle + zip, and the "Import Colab results" flow.
"""
import json

def md(src):
    return {"cell_type": "markdown", "metadata": {}, "source": src}

def code(src):
    return {"cell_type": "code", "execution_count": None, "metadata": {}, "outputs": [], "source": src}

CELL0 = md("""# WakeStudio · Train a custom openWakeWord wake word (Google Colab)

This is the **module-owned training notebook** for the
[`kws-openwakeword`](https://github.com/awareride/wake-studio/tree/main/packages/modules/kws/openwakeword)
module. Run it top-to-bottom in your own Google Colab session (free tier is
enough for the default settings) to train a custom wake-word model from a
phrase, then **download the result bundle** and import it back into
WakeStudio for in-browser testing and export.

It is modeled on the upstream openWakeWord
[`automatic_model_training_simple.ipynb`](https://github.com/dscripka/openWakeWord),
which runs on Colab's current Python (3.11/3.12) — no separate Python
environment and no legacy pins.

## How it works

1. **Step 0** — set the wake phrase and training parameters (one cell).
2. **Step 1** — installs the pinned upstream [`openWakeWord`](https://github.com/dscripka/openWakeWord)
   training stack + the [`piper-sample-generator`](https://github.com/rhasspy/piper-sample-generator)
   TTS dependencies. Uses `piper-phonemize-cross` (wheels for modern Python)
   and `onnx2tf` for TFLite export, mirroring the upstream simple notebook.
3. **Step 2** — (optional) generates one sample clip so you can hear that your
   wake phrase sounds right before a long training run.
4. **Step 3** — downloads the same public training data the upstream notebook
   uses (MIT room impulse responses, a slice of AudioSet, the FMA sample,
   precomputed ACAV100M openWakeWord features, and the validation feature set).
5. **Step 4** — writes the training **YAML config** and runs the **upstream
   `train.py` unchanged** (bytes-identical, never rewritten — WakeStudio
   adapts to the script, per `docs/modules/training.md` §4): `--generate_clips`,
   `--augment_clips`, `--train_model`. The model is exported to ONNX (and
   TFLite via `onnx2tf` when possible) into `my_custom_model/`.
6. **Step 5** — nests the trained model + metadata into the **standard
   artifact bundle** and zips it.
7. **Step 6** — download the bundle and use **"Import Colab results"** in the
   WakeStudio app.

## Expected runtime

With the default parameters (1000 train + 1000 validation samples, 10 000
steps) the full run is roughly **30–60 minutes on a free Colab CPU runtime**
(mirroring the upstream example). Switch to a **GPU** runtime to speed up
sample generation + training. Increase `N_SAMPLES` / `STEPS` for a stronger
model.

## Optional keys (Settings panel)

This notebook needs **no WakeStudio credential** and no Google API key for the
default flow. If a future data source needs one (a public TTS endpoint token, a
Google API key for Drive import, …), set it in Step 0 or via the environment
(`WAKE_STUDIO_*` / `*_TOKEN`) — read here, never hard-coded. **Never commit a
secret into this notebook.**

## Licensing note

The trained classifier is trained from TTS-generated audio and precomputed
openWakeWord features, so the resulting **model is user-owned / commercially
clean** (`provenance.json` declares `license: user-owned`). The pre-trained
openWakeWord models (CC BY-NC-SA, demo-only) are **not** bundled into the
result. The training **data** (background audio) carries a mix of licenses —
the upstream notebook flags custom models as **non-commercial for personal use
only**; verify any dataset you swap in before commercial deployment.
""")

CELL1 = md("""## Step 0 · Parameters

Edit the first cell below (or leave the defaults). Every value can also be
overridden by an environment variable, so WakeStudio can pass job params
(`wakePhrase`, `epochs`, `target`, `augment`, `quantize` from the training
panel are mapped here).
""")

CELL2 = code("""# --- WakeStudio job params (from the training panel / env) -----------------
import os, time

# The wake phrase to train. Overridable via env WAKE_PHRASE.
# Tip (upstream): spell sounds phonetically with underscores if the default
# pronunciation is off, e.g. "hey siri" -> "hey_seer_e".
WAKE_PHRASE = os.environ.get("WAKE_PHRASE", "hey studio")

# App-class ONNX model (target "app-class"; MCU/TFLite-Micro is a separate
# micro-wake-word notebook later). Overridable via env WAKE_TARGET.
WAKE_TARGET = os.environ.get("WAKE_TARGET", "app-class")

# Synthetic sample counts (upstream example defaults; raise for strength).
N_SAMPLES    = int(os.environ.get("WAKE_N_SAMPLES", "1000"))
N_SAMPLES_VAL= int(os.environ.get("WAKE_N_SAMPLES_VAL", "1000"))

# Training steps (upstream example default; full models often use 50 000+).
STEPS        = int(os.environ.get("WAKE_STEPS", "10000"))

# False-activation penalty (max_negative_weight); higher = fewer false alarms.
FALSE_ACTIVATION_PENALTY = int(os.environ.get("WAKE_FALSE_ACTIVATION", "1500"))

# Audio augmentation toggle (background mixing + room impulse responses).
AUGMENT      = os.environ.get("WAKE_AUGMENT", "true").lower() in ("1", "true", "yes")

# Quantize export: emit a TFLite model alongside the ONNX (best-effort).
QUANTIZE     = os.environ.get("WAKE_QUANTIZE", "true").lower() in ("1", "true", "yes")

# Optional keys (Settings -> Security). Read from env; never hard-coded.
GOOGLE_API_KEY = os.environ.get("GOOGLE_API_KEY", "")
TTS_ENDPOINT_TOKEN = os.environ.get("TTS_ENDPOINT_TOKEN", "")

# WakeStudio job metadata
JOB_ID   = os.environ.get("WAKE_JOB_ID", f"kws-openwakeword-{int(time.time()*1000)}")
MODULE_ID = "kws-openwakeword"
BACKEND  = "colab"
PROVIDER = "colab"

print("wakePhrase :", WAKE_PHRASE)
print("target     :", WAKE_TARGET)
print("n_samples  :", N_SAMPLES, "| n_samples_val:", N_SAMPLES_VAL)
print("steps      :", STEPS, "| augment:", AUGMENT, "| quantize:", QUANTIZE)
print("jobId      :", JOB_ID)
""")

CELL3 = md("""## Step 1 · Environment setup

Installs the upstream `openWakeWord` package (pinned ref) and the Piper TTS
sample-generator required for synthetic data. This mirrors the upstream
`automatic_model_training_simple` notebook — it runs on Colab's current Python
resource (no separate Python env) using `piper-phonemize-cross` and `onnx2tf`.
""")

CELL4 = code("""# --- Environment setup (upstream automatic_model_training_simple.ipynb) ---
import os, sys

# 1) Piper TTS sample generator (synthetic speech) — pinned commit (C-3
#    pairing with the openWakeWord ref below).
if not os.path.exists("./piper-sample-generator"):
    !git clone --quiet https://github.com/rhasspy/piper-sample-generator
    !wget -q -O piper-sample-generator/models/en_US-libritts_r-medium.pt 'https://github.com/rhasspy/piper-sample-generator/releases/download/v2.0.0/en_US-libritts_r-medium.pt'
    !cd piper-sample-generator && git checkout --quiet 213d4d5
    # piper-phonemize-cross ships wheels for modern Python (3.11/3.12).
    !pip install -q piper-tts piper-phonemize-cross
    !pip install -q webrtcvad
    !pip install -q torch==2.5.0 torchvision==0.20.0 torchaudio==2.5.0 --index-url https://download.pytorch.org/whl/cu121

if "piper-sample-generator/" not in sys.path:
    sys.path.insert(0, "piper-sample-generator/")

# 2) openWakeWord (full install to support training) — upstream default
#    branch (mirrors the upstream simple notebook, which clones at HEAD).
OPENWAKEWORD_REF = "main"
if not os.path.exists("./openwakeword"):
    !git clone --quiet https://github.com/dscripka/openwakeword
    !cd openwakeword && git checkout --quiet {OPENWAKEWORD_REF}
    !pip install -q -e ./openwakeword --no-deps

# 3) Training dependencies (upstream simple notebook pins — no legacy TF).
!pip install -q mutagen==1.47.0 torchinfo==1.8.0 torchmetrics==1.2.0 speechbrain==0.5.14 \\
    audiomentations==0.33.0 torch-audiomentations==0.11.0 acoustics==0.2.6 \\
    onnxruntime==1.22.1 ai_edge_litert==1.4.0 onnxsim onnx2tf onnx==1.19.1 \\
    onnx_graphsurgeon sng4onnx pronouncing==0.2.0 datasets==2.14.6 deep-phonemizer==0.0.19

# 4) Download the frozen feature models (Colab workaround, upstream notebook).
os.makedirs("./openwakeword/openwakeword/resources/models", exist_ok=True)
!wget -q https://github.com/dscripka/openWakeWord/releases/download/v0.5.1/embedding_model.onnx -O ./openwakeword/openwakeword/resources/models/embedding_model.onnx
!wget -q https://github.com/dscripka/openWakeWord/releases/download/v0.5.1/embedding_model.tflite -O ./openwakeword/openwakeword/resources/models/embedding_model.tflite
!wget -q https://github.com/dscripka/openWakeWord/releases/download/v0.5.1/melspectrogram.onnx -O ./openwakeword/openwakeword/resources/models/melspectrogram.onnx
!wget -q https://github.com/dscripka/openWakeWord/releases/download/v0.5.1/melspectrogram.tflite -O ./openwakeword/openwakeword/resources/models/melspectrogram.tflite

print("environment ready")
""")

CELL5 = md("""## Step 2 · (Optional) Hear your wake phrase first

Generates one synthetic sample clip so you can check the TTS pronunciation
before a long training run. If it sounds wrong, edit `target_word` in Step 0
(phonetic spelling, e.g. `hey_seer_e`) and re-run this cell. You can skip this
step — Step 3/4 will still work.
""")

CELL6 = code("""# --- Generate one sample clip to check pronunciation ----------------------
from IPython.display import Audio
from generate_samples import generate_samples

generate_samples(
    text=[WAKE_PHRASE],
    max_samples=1,
    length_scales=[1.1],
    noise_scales=[0.7],
    noise_scale_ws=[0.7],
    output_dir="./",
    batch_size=1,
    auto_reduce_batch_size=True,
    file_names=["test_generation.wav"],
)
Audio("test_generation.wav", autoplay=True)
""")

CELL7 = md("""## Step 3 · Download training data

Same public sources as the upstream `automatic_model_training_simple` notebook:

1. **MIT RIRs** (`davidscripka/MIT_environmental_impulse_responses`) — room
   impulse responses for augmentation.
2. **AudioSet** (`agkphysics/AudioSet`, part `bal_train09.tar`) — background
   noise; converted to 16 kHz wav.
3. **Free Music Archive** (`rudraml/fma`, `small`) — background music.
4. **Precomputed openWakeWord features** (`davidscripka/openwakeword_features`)
   — ~2000 h of negatives (ACAV100M) + the ~11 h validation feature set used
   for the false-positive-rate estimate.

Downloading this example data takes about **15 minutes**.
""")

CELL8 = code("""# --- Download data (upstream automatic_model_training_simple.ipynb) ---------
import locale
def getpreferredencoding(do_setlocale = True):
    return "UTF-8"
locale.getpreferredencoding = getpreferredencoding

import numpy as np
import torch
from pathlib import Path
import uuid
import yaml
import datasets
import scipy
from tqdm import tqdm

# 1) MIT room impulse responses (via git-lfs, faster than streaming)
output_dir = "./mit_rirs"
if not os.path.exists(output_dir):
    os.mkdir(output_dir)
    !git lfs install
    !git clone --quiet https://huggingface.co/datasets/davidscripka/MIT_environmental_impulse_responses
    rir_dataset = datasets.Dataset.from_dict({"audio": [str(i) for i in Path("./MIT_environmental_impulse_responses/16khz").glob("*.wav")]}).cast_column("audio", datasets.Audio())
    for row in tqdm(rir_dataset):
        name = row["audio"]["path"].split("/")[-1]
        scipy.io.wavfile.write(os.path.join(output_dir, name), 16000, (row["audio"]["array"]*32767).astype(np.int16))

# 2) AudioSet background (one part; full-scale training uses much more)
if not os.path.exists("audioset"):
    os.mkdir("audioset")
    fname = "bal_train09.tar"
    !wget -q -O audioset/bal_train09.tar https://huggingface.co/datasets/agkphysics/AudioSet/resolve/main/data/bal_train09.tar
    !cd audioset && tar -xf bal_train09.tar
    output_dir = "./audioset_16k"
    os.mkdir(output_dir)
    ad = datasets.Dataset.from_dict({"audio": [str(i) for i in Path("audioset/audio").glob("**/*.flac")]})
    ad = ad.cast_column("audio", datasets.Audio(sampling_rate=16000))
    for row in tqdm(ad):
        name = row["audio"]["path"].split("/")[-1].replace(".flac", ".wav")
        scipy.io.wavfile.write(os.path.join(output_dir, name), 16000, (row["audio"]["array"]*32767).astype(np.int16))

# 3) Free Music Archive sample (1 hour of clips)
output_dir = "./fma"
if not os.path.exists(output_dir):
    os.mkdir(output_dir)
    fma = datasets.load_dataset("rudraml/fma", name="small", split="train", streaming=True)
    fma = iter(fma.cast_column("audio", datasets.Audio(sampling_rate=16000)))
    n_hours = 1
    for i in tqdm(range(n_hours*3600//30)):
        row = next(fma)
        name = row["audio"]["path"].split("/")[-1].replace(".mp3", ".wav")
        scipy.io.wavfile.write(os.path.join(output_dir, name), 16000, (row["audio"]["array"]*32767).astype(np.int16))

# 4) Precomputed openWakeWord features (negatives + validation set)
if not os.path.exists("./openwakeword_features_ACAV100M_2000_hrs_16bit.npy"):
    !wget -q https://huggingface.co/datasets/davidscripka/openwakeword_features/resolve/main/openwakeword_features_ACAV100M_2000_hrs_16bit.npy
if not os.path.exists("validation_set_features.npy"):
    !wget -q https://huggingface.co/datasets/davidscripka/openwakeword_features/resolve/main/validation_set_features.npy

print("data ready")
""")

CELL9 = md("""## Step 4 · Train the model

Writes the training **YAML config** from the Step 0 parameters, then runs the
**upstream `train.py` unchanged** in three stages (`--generate_clips`,
`--augment_clips`, `--train_model`), and exports to TFLite via `onnx2tf`
(best-effort; ONNX is the primary deliverable). Runs in the same cell so the
`config` object stays available to Step 5's bundle builder.
""")

CELL10 = code("""# --- Write config + run the upstream train.py unchanged --------------------
import yaml

config = yaml.load(open("openwakeword/examples/custom_model.yml", "r").read(), yaml.Loader)
config["target_phrase"] = [WAKE_PHRASE]
config["model_name"] = config["target_phrase"][0].replace(" ", "_")
config["n_samples"] = N_SAMPLES
config["n_samples_val"] = N_SAMPLES_VAL
config["steps"] = STEPS
config["target_accuracy"] = 0.5
config["target_recall"] = 0.25
config["output_dir"] = "./my_custom_model"
config["max_negative_weight"] = FALSE_ACTIVATION_PENALTY
config["background_paths"] = ["./audioset_16k", "./fma"]
config["false_positive_validation_data_path"] = "validation_set_features.npy"
config["feature_data_files"] = {"ACAV100M_sample": "openwakeword_features_ACAV100M_2000_hrs_16bit.npy"}
with open("my_model.yaml", "w") as f:
    yaml.dump(config, f)

# Stage 1: generate synthetic clips
!{sys.executable} openwakeword/openwakeword/train.py --training_config my_model.yaml --generate_clips 2>&1 | tee -a train_log.txt
# Stage 2: augment the generated clips
!{sys.executable} openwakeword/openwakeword/train.py --training_config my_model.yaml --augment_clips 2>&1 | tee -a train_log.txt
# Stage 3: train the model (saves <model_name>.onnx into my_custom_model/)
!{sys.executable} openwakeword/openwakeword/train.py --training_config my_model.yaml --train_model 2>&1 | tee -a train_log.txt

# (Optional) TFLite export via onnx2tf — works on modern Python (best-effort).
model_name = config["model_name"]
onnx_path = f"my_custom_model/{model_name}.onnx"
if QUANTIZE and os.path.exists(onnx_path):
    !onnx2tf -i my_custom_model/{model_name}.onnx -o my_custom_model/ -kat onnx____Flatten_0
    !mv my_custom_model/{model_name}_float32.tflite my_custom_model/{model_name}.tflite

print("training done:", onnx_path)
""")

CELL11 = md("""## Step 5 · Normalize into the WakeStudio standard bundle

Nests the trained model + metadata down in the standard artifact bundle
(`docs/modules/training.md` §6) and zips it for download:

```
wake-studio-results/<job-id>/
  model.onnx        (model.tflite when available)
  metrics.json      (best-effort FAR/FRR + run info parsed from the log)
  metadata.json     (jobId, moduleId, backend=colab, provider, params, trainedAtMs)
  provenance.json   (license: user-owned — commercially clean)
  config.json       (AFE/KWS/Few-Shot config snapshot used for training)
  wake-studio-results.zip (the importable bundle)
```

The zip is the **only** retrieval contract the PWA's importer
(`packages/modules/training/core/manifest.ts`) needs.
""")

CELL12 = code("""# --- Build the standard artifact bundle ------------------------------------
import json, re, shutil, zipfile

model_dir = config["output_dir"]
model_name = config["model_name"]
onnx_path = f"{model_dir}/{model_name}.onnx"
tflite_path = f"{model_dir}/{model_name}.tflite"

assert os.path.exists(onnx_path), f"model not found: {onnx_path} — did Step 4 finish?"

bundle_dir = f"wake-studio-results/{JOB_ID}"
os.makedirs(bundle_dir, exist_ok=True)

# model(s)
shutil.copy(onnx_path, os.path.join(bundle_dir, "model.onnx"))
if QUANTIZE and os.path.exists(tflite_path):
    shutil.copy(tflite_path, os.path.join(bundle_dir, "model.tflite"))

# metrics.json — best-effort parse of the training log
metrics = {"status": "ok", "note": "parsed best-effort from train_log.txt"}
if os.path.exists("train_log.txt"):
    log_text = open("train_log.txt", encoding="utf-8", errors="ignore").read()
    metrics["log_tail"] = log_text.strip().splitlines()[-20:]
    for key, pat in {
        "recall": r"recall[^0-9]*([0-9.]+)",
        "accuracy": r"accuracy[^0-9]*([0-9.]+)",
        "false_positives_per_hour": r"false[- ]?positives?[^0-9]*([0-9.]+)",
    }.items():
        m = re.search(pat, log_text, re.IGNORECASE)
        if m:
            try:
                metrics[key] = float(m.group(1))
            except ValueError:
                pass
metrics["steps"] = STEPS
metrics["epochs"] = STEPS  # upstream trains for `steps` optimizer steps
with open(os.path.join(bundle_dir, "metrics.json"), "w") as f:
    json.dump(metrics, f, indent=2)

# metadata.json
metadata = {
    "jobId": JOB_ID,
    "moduleId": MODULE_ID,
    "backend": BACKEND,
    "provider": PROVIDER,
    "params": {
        "wakePhrase": WAKE_PHRASE,
        "target": WAKE_TARGET,
        "epochs": str(STEPS),
        "augment": str(AUGMENT).lower(),
        "quantize": str(QUANTIZE).lower(),
    },
    "trainedAtMs": int(time.time() * 1000),
}
with open(os.path.join(bundle_dir, "metadata.json"), "w") as f:
    json.dump(metadata, f, indent=2)

# provenance.json — user-owned / commercially clean (Phase 4 license gate)
provenance = {
    "license": "user-owned",
    "sourceData": [
        {"name": "piper-sample-generator synthetic speech", "license": "MIT (code); Piper voice model license", "source": "https://github.com/rhasspy/piper-sample-generator"},
        {"name": "openWakeWord feature extractors (frozen)", "license": "Apache-2.0", "source": "https://github.com/dscripka/openWakeWord"},
        {"name": "background audio (AudioSet / FMA samples)", "license": "research-use; verify before commercial deployment", "source": "https://huggingface.co/datasets/agkphysics/AudioSet, https://huggingface.co/datasets/rudraml/fma"},
    ],
    "notes": "Trained from synthetic TTS audio + precomputed openWakeWord features. The classifier is user-owned; pre-trained openWakeWord models (CC BY-NC-SA) are NOT bundled.",
}
with open(os.path.join(bundle_dir, "provenance.json"), "w") as f:
    json.dump(provenance, f, indent=2)

# config.json — AFE/KWS/Few-Shot config snapshot used for training
config_snapshot = {
    "wakePhrase": WAKE_PHRASE,
    "target": WAKE_TARGET,
    "backend": BACKEND,
    "provider": PROVIDER,
    "model_type": config.get("model_type", "dnn"),
    "layer_size": config.get("layer_size", 32),
    "steps": STEPS,
    "n_samples": N_SAMPLES,
    "n_samples_val": N_SAMPLES_VAL,
    "augment": AUGMENT,
    "quantize": QUANTIZE,
    "clip_size_seconds": 3,
}
with open(os.path.join(bundle_dir, "config.json"), "w") as f:
    json.dump(config_snapshot, f, indent=2)

# zip it (the PWA import contract)
zip_path = f"{bundle_dir}/wake-studio-results.zip"
with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
    for name in ("model.onnx", "model.tflite", "metrics.json", "metadata.json", "provenance.json", "config.json"):
        p = os.path.join(bundle_dir, name)
        if os.path.exists(p):
            zf.write(p, arcname=f"{JOB_ID}/{name}")

print("bundle ready:")
for name in sorted(os.listdir(bundle_dir)):
    print("  ", name, os.path.getsize(os.path.join(bundle_dir, name)), "bytes")
print("download:", zip_path)
""")

CELL13 = md("""## Step 6 · Import the bundle back into WakeStudio

1. Download **`wake-studio-results/<job-id>/wake-studio-results.zip`**
   (left-hand file browser in Colab → right-click → Download).
2. In the WakeStudio app open the **Training** view and choose
   **Import Colab results**; pick the zip.
3. The importer validates `metadata.json` + `provenance.json` (the manifest is
   shared by every backend) and registers the model for **in-browser testing**
   and **export** (the export license gate reads `provenance.json` — this
   model is `user-owned`, so it is exportable).

No WakeStudio server is involved at any point — your Google account is the
only credential.
""")

# Stable cell ids so Colab can deep-link to Step 0 (params cell) via #scrollTo.
IDS = ["intro", "step0", "params", "step1", "env", "step2", "test-clip",
       "step3", "data", "step4", "train", "step5", "bundle", "step6"]
cells = [CELL0, CELL1, CELL2, CELL3, CELL4, CELL5, CELL6, CELL7, CELL8,
         CELL9, CELL10, CELL11, CELL12, CELL13]
for cell, cid in zip(cells, IDS):
    cell["id"] = cid

nb = {
    "nbformat": 4,
    "nbformat_minor": 0,
    "metadata": {
        "colab": {
            "provenance": [],
            "name": "WakeStudio - train a custom openWakeWord wake word",
        },
        "kernelspec": {"name": "python3", "display_name": "Python 3"},
        "language_info": {"name": "python"},
    },
    "cells": cells,
}

out = "packages/modules/kws/openwakeword/train/colab/train.ipynb"
with open(out, "w") as f:
    json.dump(nb, f, indent=1)
print("wrote", out, "with", len(cells), "cells")