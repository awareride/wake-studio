"""OpenWakeWord train adapter tests (#127, ADR-031).

Pure-function tests (params, config, metrics) plus an end-to-end run against
a FAKE upstream openwakeword train.py (no GPU, no network): the adapter must
write the config, run the three upstream stages, stream NDJSON, and produce
the standard bundle zip (§6) with an `artifact` event pointing at it.
"""

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest
import yaml

ADAPTER = Path(__file__).resolve().parent.parent / "train_adapter.py"
FAKE_UPSTREAM = Path(__file__).resolve().parent / "fake_upstream" / "openwakeword"
# Fake openwakeword feature-extractor shim + the live studio-backend src (the
# module train venv has a stale installed wake_train_kit without materialize).
FAKE_FEATURES = Path(__file__).resolve().parent / "fake_upstream" / "openwakeword_features"
STUDIO_SRC = Path(__file__).resolve().parents[6] / "apps" / "studio-backend" / "src"
sys.path.insert(0, str(STUDIO_SRC))


def build_dataset_zip(tmp_path: Path, dataset_id: str = "ds-1", commercial_use: bool = True) -> Path:
    """A canonical wake-studio-dataset.zip (role-positive/unknown/noise).

    ``commercial_use=False`` builds a research-only dataset (provenance
    ``commercialUse: false``) to exercise the #210 inheritance path.
    """
    import io
    import zipfile

    manifest = {
        "schemaVersion": 1,
        "id": dataset_id,
        "name": "wake-words",
        "version": 1,
        "kind": "generated",
        "role": "mixed",
        "audio": {"sampleRate": 16000, "channels": 1, "encoding": "pcm_s16le",
                   "clips": 4, "durationSec": 8},
        "labels": [
            {"name": "hey_studio", "role": "positive"},
            {"name": "_unknown", "role": "unknown"},
            {"name": "noise", "role": "noise"},
        ],
        "provenance": [{"name": "edge-tts synthetic" if commercial_use else "research corpus", "license": "user-owned" if commercial_use else "CC BY-NC-SA 4.0", "commercialUse": commercial_use}],
        "createdAtMs": 1700000000000,
    }
    clips = {
        "hey_studio": {"a.wav": b"RIFF1", "b.wav": b"RIFF2"},
        "_unknown": {"x.wav": b"RIFF3"},
        "noise": {"bg.wav": b"RIFF4"},
    }
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("dataset.json", json.dumps(manifest))
        for label, clip_map in clips.items():
            for name, bytes_ in clip_map.items():
                zf.writestr(f"audio/{label}/{name}", bytes_)
    p = tmp_path / f"{dataset_id}.zip"
    p.write_bytes(buf.getvalue())
    return p


def run_adapter(work_dir: Path, upstream_dir: Path, out_dir: Path, env: dict[str, str]):
    full_env = {
        "WORK_DIR": str(work_dir),
        "UPSTREAM_DIR": str(upstream_dir),
        "UPSTREAM_PYTHON": sys.executable,
        "OUT_DIR": str(out_dir),
        **env,
    }
    res = subprocess.run(
        [sys.executable, str(ADAPTER)],
        cwd=str(work_dir),
        env={**os.environ, **full_env},
        capture_output=True,
        text=True,
        timeout=120,
    )
    events = []
    for line in res.stdout.splitlines():
        try:
            obj = json.loads(line)
        except (ValueError, TypeError):
            continue
        if isinstance(obj, dict) and "event" in obj:
            events.append(obj)
    return res, events


def test_read_params_defaults():
    from train_adapter import read_params

    params = read_params({})
    assert params["wakePhrase"] == "hey studio"
    assert params["steps"] == 10000
    assert params["quantize"] is True
    assert params["backend"] == "colab"
    assert params["jobId"].startswith("kws-openwakeword-")


def test_read_params_env_overrides():
    from train_adapter import read_params

    params = read_params(
        {
            "WAKE_PHRASE": "hey studio",
            "WAKE_STEPS": "500",
            "WAKE_AUGMENT": "false",
            "WAKE_BACKEND": "self-hosted",
        }
    )
    assert params["wakePhrase"] == "hey studio"
    assert params["steps"] == 500
    assert params["augment"] is False
    assert params["backend"] == "self-hosted"


def test_build_config_overrides_upstream(tmp_path):
    from train_adapter import build_config, read_params

    params = read_params({"WAKE_PHRASE": "hey studio", "WAKE_STEPS": "777"})
    cfg = build_config(params, FAKE_UPSTREAM / "examples" / "custom_model.yml",
                       tmp_path / "my_model.yaml")
    assert cfg["target_phrase"] == ["hey studio"]
    assert cfg["model_name"] == "hey_studio"
    assert cfg["steps"] == 777
    assert cfg["n_samples"] == 1000
    assert cfg["output_dir"] == "./my_custom_model"
    assert (tmp_path / "my_model.yaml").is_file()


def test_parse_metrics():
    from train_adapter import parse_metrics

    metrics = parse_metrics(
        "Epoch 1/1 loss=0.5\nValidation: recall 0.93, accuracy 0.95, "
        "false positives/hour 0.1\n"
    )
    assert metrics["recall"] == 0.93
    assert metrics["accuracy"] == 0.95
    assert metrics["false_positives_per_hour"] == 0.1
    assert metrics["status"] == "ok"
    assert len(metrics["log_tail"]) == 2

    empty = parse_metrics("")
    assert "recall" not in empty


def test_end_to_end_adapter(tmp_path):
    work = tmp_path / "work"
    out = tmp_path / "out"
    work.mkdir()
    # the fake upstream needs the data dirs referenced by the config
    for d in ("audioset_16k", "fma"):
        (work / d).mkdir()

    res, events = run_adapter(
        work,
        FAKE_UPSTREAM,
        out,
        {
            "WAKE_PHRASE": "hey studio",
            "WAKE_N_SAMPLES": "10",
            "WAKE_STEPS": "50",
            "WAKE_QUANTIZE": "true",
        },
    )
    assert res.returncode == 0, res.stderr

    kinds = [e["event"] for e in events]
    assert kinds[0] == "log"
    assert "progress" in kinds
    assert kinds[-2:] == ["artifact", "done"]

    artifact = next(e for e in events if e["event"] == "artifact")
    zip_path = Path(artifact["path"])
    assert zip_path.is_file(), "artifact event must point at the bundle zip"

    bundle = zip_path.parent  # <out>/<jobId>/
    assert (bundle / "model.onnx").is_file()
    metrics = json.loads((bundle / "metrics.json").read_text())
    assert metrics["recall"] == 0.93
    metadata = json.loads((bundle / "metadata.json").read_text())
    assert metadata["moduleId"] == "kws-openwakeword"
    assert metadata["params"]["wakePhrase"] == "hey studio"
    assert metadata["backend"] == "colab"
    assert metadata["labels"] == ["hey studio"], "metadata.labels is the ADR-039 label list"
    assert json.loads((bundle / "labels.json").read_text()) == ["hey studio"]
    assert metadata["formats"]["requested"] == ["onnx"], "requested formats (ADR-039 §4.6)"
    assert metadata["formats"]["shipped"] == ["onnx"], "fake upstream produces only onnx"
    provenance = json.loads((bundle / "provenance.json").read_text())
    assert provenance["license"] == "user-owned"

    # zip contains the job-id-prefixed entries (PWA importer contract)
    import zipfile

    with zipfile.ZipFile(zip_path) as zf:
        names = zf.namelist()
    assert any(n.endswith("model.onnx") for n in names)
    assert any(n.endswith("labels.json") for n in names)
    assert any(n.endswith("metadata.json") for n in names)


def test_end_to_end_adapter_with_datasets(tmp_path):
    """#206: the datasets[] path materializes canonical datasets into the
    openwakeword shape (positives dir + features .npy + background paths) and
    wires them into the upstream config; upstream scripts stay byte-identical."""
    from wake_train_kit.dataset_store import DatasetStore

    store_dir = tmp_path / "datasets"
    store = DatasetStore(store_dir)
    store.save(build_dataset_zip(tmp_path))

    work = tmp_path / "work"
    out = tmp_path / "out"
    work.mkdir()
    res, events = run_adapter(
        work,
        FAKE_UPSTREAM,
        out,
        {
            "WAKE_DATASETS": "ds-1",
            "DATASETS_DIR": str(store_dir),
            "WAKE_BACKEND": "self-hosted",
            "PYTHONPATH": os.pathsep.join([str(STUDIO_SRC), str(FAKE_FEATURES)]),
        },
    )
    assert res.returncode == 0, res.stderr

    kinds = [e["event"] for e in events]
    assert kinds[-2:] == ["artifact", "done"]

    # the upstream config was fed the materialized shape
    config = yaml.safe_load((work / "my_model.yaml").read_text(encoding="utf-8"))
    assert config["target_phrase"] == ["hey_studio"]
    assert any("background" in p for p in config["background_paths"])
    assert "_unknown.npy" in next(iter(config["feature_data_files"].values()))
    assert (work / "data_datasets" / "positives" / "ds-1_hey_studio_a.wav").is_file()
    assert (work / "data_datasets" / "features" / "_unknown.npy").is_file()

    artifact = next(e for e in events if e["event"] == "artifact")
    bundle = Path(artifact["path"]).parent
    metadata = json.loads((bundle / "metadata.json").read_text())
    assert metadata["params"]["datasets"] == "ds-1"
    assert metadata["labels"] == ["hey_studio"]


def test_end_to_end_adapter_inherits_research_restriction(tmp_path):
    """#210: a research-only dataset (commercialUse=false) makes the trained
    bundle non-commercially-exportable — provenance.json inherits the
    restriction and metadata records the dataset refs + license flags."""
    from wake_train_kit.dataset_store import DatasetStore

    store_dir = tmp_path / "datasets"
    store = DatasetStore(store_dir)
    store.save(build_dataset_zip(tmp_path, commercial_use=False))

    work = tmp_path / "work"
    out = tmp_path / "out"
    work.mkdir()
    res, events = run_adapter(
        work,
        FAKE_UPSTREAM,
        out,
        {
            "WAKE_DATASETS": "ds-1",
            "DATASETS_DIR": str(store_dir),
            "WAKE_BACKEND": "self-hosted",
            "PYTHONPATH": os.pathsep.join([str(STUDIO_SRC), str(FAKE_FEATURES)]),
        },
    )
    assert res.returncode == 0, res.stderr

    artifact = next(e for e in events if e["event"] == "artifact")
    bundle = Path(artifact["path"]).parent

    provenance = json.loads((bundle / "provenance.json").read_text())
    assert provenance["license"] == "research-only"
    assert provenance["commercialUse"] is False
    assert provenance["restrictedBy"] == ["research corpus"]
    assert provenance["sourceData"][0]["name"] == "research corpus"

    metadata = json.loads((bundle / "metadata.json").read_text())
    assert metadata["datasetRefs"] == [
        {"id": "ds-1", "name": "wake-words", "version": 1,
         "license": "CC BY-NC-SA 4.0", "commercialUse": False}
    ]


def test_missing_upstream_fails_cleanly(tmp_path):
    work = tmp_path / "work"
    work.mkdir()
    res, events = run_adapter(work, tmp_path / "nope", tmp_path / "out", {})
    assert res.returncode == 1
    assert events[-1]["event"] == "error"
    assert "not found" in events[-1]["message"]
