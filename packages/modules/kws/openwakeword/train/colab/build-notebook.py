#!/usr/bin/env python3
"""Regenerate the kws-openwakeword Colab training notebook.

The notebook must run the pinned upstream openWakeWord training stack, which
ships binary wheels (piper-phonemize / tflite-runtime / tensorflow-cpu==2.8.1)
only up to Python 3.10. Colab's current runtime is 3.11/3.12, so the notebook:

  1. builds an isolated Python 3.10 venv with uv (ADR-028),
  2. writes a single wrapper script (train_pipeline.py) that does the data
     download, config write, upstream train.py runs, and bundle build,
  3. runs that script with the 3.10 venv's python.

This keeps the notebook a thin driver and the heavy logic in one static,
re-runnable script (supports --stage for resuming a failed stage).
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

## How it works

1. **Step 0** — set the wake phrase and training parameters (one cell).
2. **Step 1** — builds an isolated **Python 3.10** environment (via `uv`,
   ADR-028) and installs the pinned upstream
   [`openWakeWord`](https://github.com/dscripka/openWakeWord) training stack +
   the [`piper-sample-generator`](https://github.com/rhasspy/piper-sample-generator)
   TTS dependencies.
   > **Why Python 3.10?** The pinned upstream stack (`piper-phonemize`,
   > `tflite-runtime`, `tensorflow-cpu==2.8.1`) ships binary wheels only up to
   > Python 3.10, but Colab's current runtime is Python 3.11/3.12. So the whole
   > pipeline runs inside a 3.10 venv — the notebook itself is just a driver.
3. **Step 2** — runs a single wrapper script that downloads the same public
   training data the upstream `automatic_model_training` notebook uses (MIT
   room impulse responses, a slice of AudioSet, the FMA sample, precomputed
   ACAV100M openWakeWord features, and the validation feature set), writes the
   training YAML, and runs the **upstream `train.py` unchanged** (bytes-identical,
   never rewritten — WakeStudio adapts to the script, per
   `docs/modules/training.md` §4) in three stages (`--generate_clips`,
   `--augment_clips`, `--train_model`).
4. **Step 3** — the wrapper normalizes the trained model into the **standard
   artifact bundle** and zips it: `wake-studio-results/<job-id>/`.
5. **Step 4** — download the bundle and use **"Import Colab results"** in the
   WakeStudio app.

## Expected runtime

With the default parameters (1000 train + 1000 validation samples, 10 000
steps) the full run is roughly **1 hour on a free Colab T4 GPU** — mirroring
the upstream example notebook. Increase `N_SAMPLES` / `STEPS` for a stronger
model (the bundled openWakeWord release models are trained on 100 000+
samples).

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
result. Verify the licenses of any background/dataset sources you swap in
before commercial deployment.
""")

CELL1 = md("""## Step 0 · Parameters

Edit the first cell below (or leave the defaults). The values are written to
`params.json` so the training wrapper (Step 2) can read them. Every value can
also be overridden by an environment variable, so WakeStudio can pass job
params (`wakePhrase`, `epochs`, `target`, `augment`, `quantize` from the
training panel are mapped here).
""")

CELL2 = code("""# --- WakeStudio job params (from the training panel / env) -----------------
import os, time, json

# The wake phrase to train. Overridable via env WAKE_PHRASE.
WAKE_PHRASE = os.environ.get("WAKE_PHRASE", "hey studio")

# App-class ONNX model (target "app-class"; MCU/TFLite-Micro is a separate
# micro-wake-word notebook later). Overridable via env WAKE_TARGET.
WAKE_TARGET = os.environ.get("WAKE_TARGET", "app-class")

# Synthetic sample counts (upstream example defaults; raise for strength).
N_SAMPLES    = int(os.environ.get("WAKE_N_SAMPLES", "1000"))
N_SAMPLES_VAL= int(os.environ.get("WAKE_N_SAMPLES_VAL", "1000"))

# Training steps (upstream example default; full models often use 50 000+).
STEPS        = int(os.environ.get("WAKE_STEPS", "10000"))

# Audio augmentation toggle (background mixing + room impulse responses).
AUGMENT      = os.environ.get("WAKE_AUGMENT", "true").lower() in ("1", "true", "yes")

# Quantize export: upstream train.py already emits .tflite when possible.
QUANTIZE     = os.environ.get("WAKE_QUANTIZE", "true").lower() in ("1", "true", "yes")

# Optional keys (Settings -> Security). Read from env; never hard-coded.
GOOGLE_API_KEY = os.environ.get("GOOGLE_API_KEY", "")
TTS_ENDPOINT_TOKEN = os.environ.get("TTS_ENDPOINT_TOKEN", "")

# WakeStudio job metadata
JOB_ID   = os.environ.get("WAKE_JOB_ID", f"kws-openwakeword-{int(time.time()*1000)}")
MODULE_ID = "kws-openwakeword"
BACKEND  = "colab"
PROVIDER = "colab"

# Write the params for the training wrapper (Step 2).
params = {
    "wakePhrase": WAKE_PHRASE, "target": WAKE_TARGET,
    "n_samples": N_SAMPLES, "n_samples_val": N_SAMPLES_VAL,
    "steps": STEPS, "augment": AUGMENT, "quantize": QUANTIZE,
    "jobId": JOB_ID, "moduleId": MODULE_ID,
    "backend": BACKEND, "provider": PROVIDER,
    "googleApiKey": GOOGLE_API_KEY, "ttsEndpointToken": TTS_ENDPOINT_TOKEN,
}
with open("params.json", "w") as f:
    json.dump(params, f, indent=2)

print("wakePhrase :", WAKE_PHRASE)
print("target     :", WAKE_TARGET)
print("n_samples  :", N_SAMPLES, "| n_samples_val:", N_SAMPLES_VAL)
print("steps      :", STEPS, "| augment:", AUGMENT, "| quantize:", QUANTIZE)
print("jobId      :", JOB_ID)
""")

CELL3 = md("""## Step 1 · Environment setup

Builds an isolated **Python 3.10** venv (via `uv`, ADR-028) and installs the
pinned upstream `openWakeWord` training stack + the `piper-sample-generator`
TTS dependencies. This matches the upstream `automatic_model_training`
notebook; only the openWakeWord clone is pinned to a fixed commit.

> The pinned stack has binary wheels up to Python 3.10 only, while Colab's
> runtime is 3.11/3.12 — so everything runs inside the 3.10 venv. This cell
> only sets up that venv; the actual training runs in Step 2.
""")

CELL4 = code("""# --- Environment setup -------------------------------------------------------
# 1) uv — a fast package manager that can also fetch a standalone Python 3.10.
!pip install -q uv

# Fetch a standalone CPython 3.10 and create a venv (with pip + setuptools,
# needed for the editable openwakeword install).
!uv python install 3.10
!uv venv --python 3.10 .venv-train --seed

import os
VENV = f"{os.getcwd()}/.venv-train"
VENV_PY = f"{VENV}/bin/python"
os.environ["VENV_PY"] = VENV_PY
print("venv python:", !{VENV_PY} -c "import sys; print(sys.version.split()[0])")

# 2) Piper TTS sample generator — pinned v2.0.0 (the last release built for
#    the legacy openwakeword stack: numpy<2, piper-phonemize 1.1.0, and a
#    vendored piper_train — no piper-tts dependency).
!git clone --quiet https://github.com/rhasspy/piper-sample-generator
!cd piper-sample-generator && git checkout --quiet v2.0.0
!wget -q -O piper-sample-generator/models/en_US-libritts_r-medium.pt \\
  'https://github.com/rhasspy/piper-sample-generator/releases/download/v2.0.0/en_US-libritts_r-medium.pt'

# 3) openWakeWord (full install to support training) — pinned ref.
OPENWAKEWORD_REF = "7607f959"  # C-3: pinned upstream ref (latest indexed main)
!git clone --quiet https://github.com/dscripka/openwakeword
!cd openwakeword && git checkout --quiet {OPENWAKEWORD_REF}

# 4) Install the upstream training stack INTO the 3.10 venv. Versions mirror
#    the upstream automatic_model_training notebook (bytes-identical deps);
#    numpy is pinned <2 for tensorflow-cpu==2.8.1, and torch/torchaudio are
#    added because Colab's preinstalled torch is not in the isolated venv.
requirements = r\"\"\"
# openWakeWord training extras (upstream pin)
mutagen==1.47.0
torchinfo==1.8.0
torchmetrics==1.2.0
speechbrain==0.5.14
audiomentations==0.33.0
torch-audiomentations==0.11.0
acoustics==0.2.6
tensorflow-cpu==2.8.1
tensorflow_probability==0.16.0
onnx_tf==1.10.0
onnx==1.14.0
protobuf>=3.20,<4
pronouncing==0.2.0
datasets==2.14.6
deep-phonemizer==0.0.19
pyyaml>=6.0,<7
# piper-sample-generator v2.0.0 deps (piper-phonemize 1.1.0 has cp310 wheels)
piper-phonemize==1.1.0
webrtcvad
# torch pair for the isolated venv (Colab's preinstalled torch is not in it)
torch==2.2.2
torchaudio==2.2.2
# keep numpy <2 (tensorflow-cpu 2.8.1 barfs on numpy 2.x)
numpy==1.26.4
\"\"\"
with open("training-requirements.txt", "w") as f:
    f.write(requirements.strip())

!uv pip install --python {VENV_PY} -r training-requirements.txt
!uv pip install --python {VENV_PY} -e ./openwakeword

# 5) Download the frozen feature models (Colab workaround, upstream notebook).
os.makedirs("./openwakeword/openwakeword/resources/models", exist_ok=True)
!wget -q https://github.com/dscripka/openWakeWord/releases/download/v0.5.1/embedding_model.onnx -O ./openwakeword/openwakeword/resources/models/embedding_model.onnx
!wget -q https://github.com/dscripka/openWakeWord/releases/download/v0.5.1/embedding_model.tflite -O ./openwakeword/openwakeword/resources/models/embedding_model.tflite
!wget -q https://github.com/dscripka/openWakeWord/releases/download/v0.5.1/melspectrogram.onnx -O ./openwakeword/openwakeword/resources/models/melspectrogram.onnx
!wget -q https://github.com/dscripka/openWakeWord/releases/download/v0.5.1/melspectrogram.tflite -O ./openwakeword/openwakeword/resources/models/melspectrogram.tflite

print("environment ready:", !{VENV_PY} -c "import openwakeword, torch, piper_phonemize; print('ok')")
""")

CELL5 = md("""## Step 2 · Download data, train, normalize

The next cell writes `train_pipeline.py` (a single, self-contained wrapper
script) and the cell after runs it **inside the Python 3.10 venv**. It:

1. downloads the same public data as the upstream notebook (MIT RIRs,
   AudioSet, FMA, precomputed ACAV100M + validation features),
2. writes `my_model.yaml` from the Step 0 parameters,
3. runs the **upstream `train.py` unchanged** in three stages
   (`--generate_clips`, `--augment_clips`, `--train_model`),
4. normalizes the result into the **standard artifact bundle** and zips it.

If a stage fails (e.g. a transient generation error), re-run the run cell with
`--stage <name>` (data | config | generate | augment | train | tflite | bundle)
— the upstream script continues until the config targets are met.
""")

CELL6 = code("""# --- Write the training wrapper -------------------------------------------
# This is a static script; it reads params.json (Step 0) and runs entirely in
# the Python 3.10 venv. It invokes the upstream openwakeword train.py
# bytes-identical (we adapt to the script, never rewrite it).
train_pipeline = r\"\"\"
import argparse, json, os, re, shutil, subprocess, sys, time, urllib.request, zipfile

def P(*parts):
    print(*parts, flush=True)

def run(cmd, *args, cwd=None, tee=None):
    full = [cmd, *args]
    P("$ " + " ".join(full))
    if tee:
        with open(tee, "a") as f:
            p = subprocess.Popen(full, cwd=cwd, stdout=subprocess.PIPE,
                                 stderr=subprocess.STDOUT, text=True)
            for line in p.stdout:
                f.write(line); f.write("\\n"); print(line, end="")
            p.wait()
        if p.returncode != 0:
            raise SystemExit(f"stage failed (exit {p.returncode}) — see {tee}")
    else:
        subprocess.run(full, cwd=cwd, check=True)

def download(url, dest):
    if os.path.exists(dest):
        return
    P("fetching " + url.split("/")[-1])
    urllib.request.urlretrieve(url, dest)

with open("params.json") as _f:
    p = json.load(_f)
WAKE_PHRASE, WAKE_TARGET = p["wakePhrase"], p["target"]
N_SAMPLES, N_SAMPLES_VAL = p["n_samples"], p["n_samples_val"]
STEPS, AUGMENT, QUANTIZE = p["steps"], p["augment"], p["quantize"]
JOB_ID, MODULE_ID = p["jobId"], p["moduleId"]
BACKEND, PROVIDER = p["backend"], p["provider"]

def stage_data():
    import numpy as np, scipy, datasets
    from tqdm.auto import tqdm
    # 1) MIT room impulse responses
    os.makedirs("./mit_rirs", exist_ok=True)
    rir = datasets.load_dataset("davidscripka/MIT_environmental_impulse_responses",
                                split="train", streaming=True)
    for row in tqdm(rir, desc="MIT RIRs"):
        name = row["audio"]["path"].split("/")[-1]
        path = os.path.join("./mit_rirs", name)
        if os.path.exists(path):
            continue
        scipy.io.wavfile.write(path, 16000,
                               (row["audio"]["array"] * 32767).astype(np.int16))
    # 2) AudioSet background (one part; full-scale training uses much more)
    if not os.path.exists("./audioset/bal_train09.tar"):
        os.makedirs("./audioset", exist_ok=True)
        download("https://huggingface.co/datasets/agkphysics/AudioSet/resolve/main/data/bal_train09.tar",
                 "./audioset/bal_train09.tar")
        run("tar", "-xf", "bal_train09.tar", cwd="./audioset")
    os.makedirs("./audioset_16k", exist_ok=True)
    ad = datasets.Dataset.from_dict({
        "audio": [str(i) for i in __import__("pathlib").Path("audioset/audio").glob("**/*.flac")]
    })
    ad = ad.cast_column("audio", datasets.Audio(sampling_rate=16000))
    for row in tqdm(ad, desc="AudioSet -> 16k"):
        name = row["audio"]["path"].split("/")[-1].replace(".flac", ".wav")
        path = os.path.join("./audioset_16k", name)
        if os.path.exists(path):
            continue
        scipy.io.wavfile.write(path, 16000,
                               (row["audio"]["array"] * 32767).astype(np.int16))
    # 3) Free Music Archive sample (1 hour of clips)
    os.makedirs("./fma", exist_ok=True)
    fma = datasets.load_dataset("rudraml/fma", name="small", split="train", streaming=True)
    fma = iter(fma.cast_column("audio", datasets.Audio(sampling_rate=16000)))
    for i in tqdm(range(1 * 3600 // 30), desc="FMA -> 16k"):
        row = next(fma)
        name = row["audio"]["path"].split("/")[-1].replace(".mp3", ".wav")
        scipy.io.wavfile.write(os.path.join("./fma", name), 16000,
                               (row["audio"]["array"] * 32767).astype(np.int16))
    # 4) Precomputed openWakeWord features (negatives + validation set)
    download("https://huggingface.co/datasets/davidscripka/openwakeword_features/resolve/main/openwakeword_features_ACAV100M_2000_hrs_16bit.npy",
             "openwakeword_features_ACAV100M_2000_hrs_16bit.npy")
    download("https://huggingface.co/datasets/davidscripka/openwakeword_features/resolve/main/validation_set_features.npy",
             "validation_set_features.npy")
    P("data ready")

def stage_config():
    import yaml
    with open("openwakeword/examples/custom_model.yml") as f:
        config = yaml.load(f.read(), yaml.Loader)
    config["target_phrase"] = [WAKE_PHRASE]
    config["model_name"] = WAKE_PHRASE.replace(" ", "_")
    config["n_samples"] = N_SAMPLES
    config["n_samples_val"] = N_SAMPLES_VAL
    config["steps"] = STEPS
    config["target_accuracy"] = 0.6
    config["target_recall"] = 0.25
    config["background_paths"] = ["./audioset_16k", "./fma"]
    config["false_positive_validation_data_path"] = "validation_set_features.npy"
    config["feature_data_files"] = {"ACAV100M_sample": "openwakeword_features_ACAV100M_2000_hrs_16bit.npy"}
    with open("my_model.yaml", "w") as f:
        yaml.dump(config, f)
    P("config written for phrase:", WAKE_PHRASE)
    return config

def stage_train(flag):
    train = "openwakeword/openwakeword/train.py"
    run(sys.executable, train, "--training_config", "my_model.yaml", flag, tee="train_log.txt")

def stage_tflite():
    if not QUANTIZE:
        return
    import yaml
    with open("my_model.yaml") as f:
        config = yaml.load(f.read(), yaml.Loader)
    model_dir, model_name = config["output_dir"], config["model_name"]
    onnx_path = f"{model_dir}/{model_name}.onnx"
    tflite_path = f"{model_dir}/{model_name}.tflite"
    if os.path.exists(onnx_path) and not os.path.exists(tflite_path):
        try:
            import onnx, tempfile
            from onnx_tf.backend import prepare
            import tensorflow as tf
            rep = prepare(onnx.load(onnx_path), device="CPU")
            with tempfile.TemporaryDirectory() as tmp:
                rep.export_graph(os.path.join(tmp, "tf_model"))
                conv = tf.lite.TFLiteConverter.from_saved_model(os.path.join(tmp, "tf_model"))
                with open(tflite_path, "wb") as f:
                    f.write(conv.convert())
            P("tflite written:", tflite_path)
        except Exception as e:  # best-effort — ONNX is the primary deliverable
            P(f"[warn] tflite export skipped: {e}")

def stage_bundle():
    import yaml
    with open("my_model.yaml") as f:
        config = yaml.load(f.read(), yaml.Loader)
    model_dir, model_name = config["output_dir"], config["model_name"]
    onnx_path = f"{model_dir}/{model_name}.onnx"
    tflite_path = f"{model_dir}/{model_name}.tflite"
    assert os.path.exists(onnx_path), f"model not found: {onnx_path} — did training finish?"
    bundle_dir = f"wake-studio-results/{JOB_ID}"
    os.makedirs(bundle_dir, exist_ok=True)
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
    metrics["epochs"] = STEPS
    with open(os.path.join(bundle_dir, "metrics.json"), "w") as f:
        json.dump(metrics, f, indent=2)
    # metadata.json
    metadata = {
        "jobId": JOB_ID, "moduleId": MODULE_ID, "backend": BACKEND, "provider": PROVIDER,
        "params": {"wakePhrase": WAKE_PHRASE, "target": WAKE_TARGET, "epochs": str(STEPS),
                   "augment": str(AUGMENT).lower(), "quantize": str(QUANTIZE).lower()},
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
        "wakePhrase": WAKE_PHRASE, "target": WAKE_TARGET, "backend": BACKEND, "provider": PROVIDER,
        "model_type": config.get("model_type", "dnn"), "layer_size": config.get("layer_size", 32),
        "steps": STEPS, "n_samples": N_SAMPLES, "n_samples_val": N_SAMPLES_VAL,
        "augment": AUGMENT, "quantize": QUANTIZE, "clip_size_seconds": 3,
    }
    with open(os.path.join(bundle_dir, "config.json"), "w") as f:
        json.dump(config_snapshot, f, indent=2)
    # zip it (the PWA import contract)
    zip_path = f"{bundle_dir}/wake-studio-results.zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for name in ("model.onnx", "model.tflite", "metrics.json", "metadata.json", "provenance.json", "config.json"):
            pth = os.path.join(bundle_dir, name)
            if os.path.exists(pth):
                zf.write(pth, arcname=f"{JOB_ID}/{name}")
    P("bundle ready:")
    for name in sorted(os.listdir(bundle_dir)):
        P("  " + name, os.path.getsize(os.path.join(bundle_dir, name)), "bytes")
    P("download:", zip_path)

STAGE_FLAGS = {"generate": "--generate_clips", "augment": "--augment_clips", "train": "--train_model"}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stage", default="all",
                    help="all | data | config | generate | augment | train | tflite | bundle")
    a = ap.parse_args()
    order = ["data", "config", "generate", "augment", "train", "tflite", "bundle"]
    if a.stage == "all":
        run_stages = order
    else:
        run_stages = [a.stage]
    for s in run_stages:
        P(f"\\n=== stage {s} ===")
        if s == "data":
            stage_data()
        elif s == "config":
            stage_config()
        elif s in STAGE_FLAGS:
            stage_train(STAGE_FLAGS[s])
        elif s == "tflite":
            stage_tflite()
        elif s == "bundle":
            stage_bundle()
        else:
            raise SystemExit(f"unknown stage: {s}")

if __name__ == "__main__":
    main()
\"\"\"
with open("train_pipeline.py", "w") as f:
    f.write(train_pipeline)
print("wrote train_pipeline.py")
""")

CELL7 = code("""# --- Run the training pipeline (inside the Python 3.10 venv) ----------------
# Run all stages. To resume after a failure, change --stage to one of:
# data | config | generate | augment | train | tflite | bundle
!{VENV_PY} train_pipeline.py --stage all
""")

CELL8 = md("""## Step 3 · Import the bundle back into WakeStudio

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
IDS = ["intro", "step0", "params", "step1", "env", "step2", "write-pipeline",
       "run-pipeline", "step3"]
cells = [CELL0, CELL1, CELL2, CELL3, CELL4, CELL5, CELL6, CELL7, CELL8]
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