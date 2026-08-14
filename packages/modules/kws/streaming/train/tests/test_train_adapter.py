"""kws-streaming train adapter tests (#152, ADR-031).

Pure-function tests (params, command, metrics) plus an end-to-end run against a
FAKE upstream `model_train_eval.py` (no GPU, no network): the adapter must
prepare a local data dir, run the unmodified upstream invocation, stream NDJSON,
and produce the standard bundle zip (§6) with an `artifact` event pointing at it.
"""

import json
import os
import subprocess
import sys
import zipfile
from pathlib import Path

import pytest

ADAPTER = Path(__file__).resolve().parent.parent / "train_adapter.py"
FAKE_UPSTREAM = (
    Path(__file__).resolve().parent / "fake_upstream" / "google-research"
)


def run_adapter(
    work_dir: Path,
    upstream_dir: Path,
    out_dir: Path,
    env: dict[str, str],
    data_dir: Path | None = None,
):
    if data_dir is None:
        data_dir = work_dir / "data_local"
        data_dir.mkdir(parents=True, exist_ok=True)
        (data_dir / "yes").mkdir()
    full_env = {
        "WORK_DIR": str(work_dir),
        "UPSTREAM_DIR": str(upstream_dir),
        "UPSTREAM_PYTHON": sys.executable,
        "OUT_DIR": str(out_dir),
        "STREAM_DATA_SOURCE": "local-dir",
        "STREAM_DATA_DIR": str(data_dir),
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
    assert params["model"] == "ds_tc_resnet"
    assert params["wantedWords"] == "yes"
    assert params["dataSource"] == "speech-commands-v2"
    assert params["featureType"] == "mfcc_op"
    assert params["preprocess"] == "raw"
    assert params["howManyTrainingSteps"] == "10000,10000,10000"
    assert params["jobId"].startswith("kws-streaming-")
    assert params["backend"] == "colab"


def test_read_params_env_overrides():
    from train_adapter import read_params

    params = read_params(
        {
            "STREAM_MODEL": "bc_resnet",
            "STREAM_WANTED_WORDS": "hey,studio",
            "STREAM_DATA_SOURCE": "edge-tts",
            "STREAM_TTS_SAMPLES": "5",
            "STREAM_BACKEND": "self-hosted",
        }
    )
    assert params["model"] == "bc_resnet"
    assert params["wantedWords"] == "hey,studio"
    assert params["dataSource"] == "edge-tts"
    assert params["ttsSamples"] == 5
    assert params["backend"] == "self-hosted"


def test_read_params_wake_params_json():
    from train_adapter import read_params

    params = read_params(
        {
            "WAKE_PARAMS": json.dumps(
                {"model": "cnn", "howManyTrainingSteps": "500,500,500"}
            )
        }
    )
    assert params["model"] == "cnn"
    assert params["howManyTrainingSteps"] == "500,500,500"
    # STREAM_* wins over WAKE_PARAMS
    params = read_params(
        {
            "WAKE_PARAMS": json.dumps({"model": "cnn"}),
            "STREAM_MODEL": "ds_cnn",
        }
    )
    assert params["model"] == "ds_cnn"


def test_build_command_flags():
    from train_adapter import build_command, read_params

    params = read_params({})
    cmd = build_command(
        params, "/usr/bin/python3", "/tmp/data", "/tmp/train", "yes"
    )
    joined = " ".join(cmd)
    assert cmd[0] == "/usr/bin/python3"
    assert cmd[1:3] == ["-m", "kws_streaming.train.model_train_eval"]
    assert "--data_dir" in cmd and "/tmp/data" in cmd
    assert "--train_dir" in cmd and "/tmp/train" in cmd
    assert "--wanted_words" in cmd and "yes" in cmd
    assert "--feature_type" in cmd and "mfcc_op" in cmd
    assert "--preprocess" in cmd and "raw" in cmd
    assert "--train" in cmd and "1" in cmd
    assert cmd[-1] == "ds_tc_resnet"  # positional model
    assert "ds_tc_resnet" in joined


def test_parse_metrics(tmp_path):
    from train_adapter import parse_metrics

    stream = tmp_path / "tflite_stream_state_external"
    stream.mkdir()
    (stream / "tflite_stream_state_external_model_accuracy_reset0.txt").write_text(
        "TFLite test accuracy = 0.9761\n"
    )
    (tmp_path / "accuracy_last.txt").write_text("accuracy = 0.99\n")

    metrics = parse_metrics(tmp_path, "line1\nline2")
    assert metrics["streaming_accuracy_reset0"] == 0.9761
    assert metrics["last_training_accuracy"] == 0.99
    assert metrics["log_tail"] == ["line1", "line2"]
    assert "streaming_accuracy_reset1" not in metrics


def test_end_to_end_adapter(tmp_path):
    work = tmp_path / "work"
    out = tmp_path / "out"
    work.mkdir()
    data = work / "data_local"
    data.mkdir()
    (data / "yes").mkdir()

    res, events = run_adapter(
        work,
        FAKE_UPSTREAM,
        out,
        {
            "STREAM_MODEL": "ds_tc_resnet",
            "STREAM_WANTED_WORDS": "yes",
            "STREAM_BACKEND": "self-hosted",
        },
        data_dir=data,
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
    assert (bundle / "model.tflite").is_file()
    assert (bundle / "labels.txt").is_file()
    assert (bundle / "flags.json").is_file()
    labels = (bundle / "labels.txt").read_text().splitlines()
    assert labels == ["_silence_", "_unknown_", "yes"]

    metrics = json.loads((bundle / "metrics.json").read_text())
    assert metrics["streaming_accuracy_reset0"] == 0.98
    assert metrics["last_training_accuracy"] == 0.99

    metadata = json.loads((bundle / "metadata.json").read_text())
    assert metadata["moduleId"] == "kws-streaming"
    assert metadata["params"]["model"] == "ds_tc_resnet"
    assert metadata["backend"] == "self-hosted"

    provenance = json.loads((bundle / "provenance.json").read_text())
    assert provenance["license"] == "user-owned"

    with zipfile.ZipFile(zip_path) as zf:
        names = zf.namelist()
    assert any(n.endswith("model.tflite") for n in names)
    assert any(n.endswith("metadata.json") for n in names)


def test_upstream_failure_propagates(tmp_path):
    work = tmp_path / "work"
    out = tmp_path / "out"
    work.mkdir()
    data = work / "data_local"
    data.mkdir()
    (data / "yes").mkdir()

    res, events = run_adapter(
        work,
        FAKE_UPSTREAM,
        out,
        {"FAKE_STREAM_FAIL": "1"},
        data_dir=data,
    )
    assert res.returncode == 3
    assert events[-1]["event"] == "error"
    assert "exited with code 3" in events[-1]["message"]


def test_missing_upstream_fails_cleanly(tmp_path):
    work = tmp_path / "work"
    work.mkdir()
    res, events = run_adapter(work, tmp_path / "nope", tmp_path / "out", {})
    assert res.returncode == 1
    assert events[-1]["event"] == "error"
    assert "not found" in events[-1]["message"]


def test_non_streamable_missing_model_fails(tmp_path):
    work = tmp_path / "work"
    out = tmp_path / "out"
    work.mkdir()
    data = work / "data_local"
    data.mkdir()
    (data / "yes").mkdir()

    res, events = run_adapter(
        work,
        FAKE_UPSTREAM,
        out,
        {"FAKE_STREAM_NO_MODEL": "1"},
        data_dir=data,
    )
    assert res.returncode == 1
    assert events[-1]["event"] == "error"
    assert "streaming tflite not found" in events[-1]["message"]


def test_prepare_data_edge_tts(monkeypatch, tmp_path):
    """The edge-tts source builds the label tree + derives wanted words."""
    import train_adapter

    class FakeDs:
        @staticmethod
        def build_edge_tts_kws_dataset(phrases, languages, out, samples_per_phrase=3,
                                       unknown_words=None, sample_rate=16000,
                                       voices=None, reporter=None):
            (out / "hey_studio").mkdir(parents=True, exist_ok=True)
            return {"name": "edge-tts", "commercialUse": True}

    monkeypatch.setattr(train_adapter, "_import_data_sources", lambda: FakeDs)
    params = train_adapter.read_params(
        {"STREAM_DATA_SOURCE": "edge-tts", "STREAM_WAKE_PHRASES": "hey studio,ok studio"}
    )

    class R:
        def emit(self, event, **fields):
            pass

    data_dir, sources, wanted = train_adapter.prepare_data(
        params, tmp_path, R()
    )
    assert wanted == "hey_studio,ok_studio"
    assert sources[0]["commercialUse"] is True
    assert (Path(data_dir) / "hey_studio").is_dir()


def test_prepare_data_user_url(monkeypatch, tmp_path):
    """The user-url source passes the URL through and keeps wanted words."""
    import train_adapter

    class FakeDs:
        @staticmethod
        def prepare_user_archive(url, data_dir, reporter=None):
            assert url == "https://example.com/ds.tar.gz"
            (data_dir / "up").mkdir(parents=True, exist_ok=True)
            return data_dir, {"name": "user", "commercialUse": False}

    monkeypatch.setattr(train_adapter, "_import_data_sources", lambda: FakeDs)
    params = train_adapter.read_params(
        {
            "STREAM_DATA_SOURCE": "user-url",
            "STREAM_DATA_URL": "https://example.com/ds.tar.gz",
            "STREAM_WANTED_WORDS": "up,down",
        }
    )

    class R:
        def emit(self, event, **fields):
            pass

    data_dir, sources, wanted = train_adapter.prepare_data(params, tmp_path, R())
    assert wanted == "up,down"
    assert sources[0]["commercialUse"] is False
    assert (Path(data_dir) / "up").is_dir()

