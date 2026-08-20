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
# The adapter imports wake_train_kit.materialize (the live source in the
# studio-backend) for the datasets[] path; the module train venv has a stale
# installed wheel without it, so the datasets test shadows it via PYTHONPATH.
STUDIO_SRC = Path(__file__).resolve().parents[6] / "apps" / "studio-backend" / "src"

# The test itself also imports wake_train_kit.dataset_store (stale installed
# wheel in this venv) to build the store; point at the live source.
sys.path.insert(0, str(STUDIO_SRC))


def build_dataset_zip(tmp_path: Path, dataset_id: str = "ds-1") -> Path:
    """A canonical wake-studio-dataset.zip (role-positive/unknown/noise)."""
    import io
    import json
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
        "provenance": [{"name": "edge-tts synthetic", "license": "user-owned", "commercialUse": True}],
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


def run_adapter(
    work_dir: Path,
    upstream_dir: Path,
    out_dir: Path,
    env: dict[str, str],
    data_dir: Path | None = None,
    skip_tf_guard: bool = True,
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
    if skip_tf_guard:  # the fake-upstream tests run without TensorFlow (ADR-038)
        full_env["STREAM_SKIP_TF_GUARD"] = "1"
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
    # empty = derive the wake words from the picked datasets' positive labels (#206)
    assert params["wantedWords"] == ""
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


def test_read_params_mixed_sources():
    from train_adapter import read_params

    params = read_params(
        {
            "STREAM_DATA_SOURCE": "mixed",
            "STREAM_POSITIVE_SOURCE": "edge-tts",
            "STREAM_NEGATIVE_SOURCE": "user-url",
        }
    )
    assert params["dataSource"] == "mixed"
    assert params["positiveSource"] == "edge-tts"
    assert params["negativeSource"] == "user-url"
    # defaults remain for unset params
    params = read_params({})
    assert params["positiveSource"] == "edge-tts"
    assert params["negativeSource"] == "speech-commands-v2"


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
    assert json.loads((bundle / "labels.json").read_text()) == ["_silence_", "_unknown_", "yes"], \
        "labels.json is the standard ADR-039 label list (from upstream labels.txt)"

    metrics = json.loads((bundle / "metrics.json").read_text())
    assert metrics["streaming_accuracy_reset0"] == 0.98
    assert metrics["last_training_accuracy"] == 0.99

    metadata = json.loads((bundle / "metadata.json").read_text())
    assert metadata["moduleId"] == "kws-streaming"
    assert metadata["params"]["model"] == "ds_tc_resnet"
    assert metadata["backend"] == "self-hosted"
    assert metadata["labels"] == ["_silence_", "_unknown_", "yes"]
    assert metadata["formats"]["requested"] == ["tflite"], "requested formats (ADR-039 §4.6)"
    assert metadata["formats"]["shipped"] == ["tflite"], "onnx derivation lands with #177"

    provenance = json.loads((bundle / "provenance.json").read_text())
    assert provenance["license"] == "user-owned"

    with zipfile.ZipFile(zip_path) as zf:
        names = zf.namelist()
    assert any(n.endswith("model.tflite") for n in names)
    assert any(n.endswith("labels.json") for n in names)
    assert any(n.endswith("metadata.json") for n in names)


def test_end_to_end_adapter_with_datasets(tmp_path):
    """#206: prepare_data becomes load-refs → materialize → merge. The wizard's
    datasets[] refs flow to STREAM_DATASETS; the adapter materializes the
    canonical dataset into the kws-streaming label tree and trains on it."""
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
            "STREAM_DATASETS": "ds-1",
            "DATASETS_DIR": str(store_dir),
            "STREAM_BACKEND": "self-hosted",
            "PYTHONPATH": str(STUDIO_SRC),
        },
    )
    assert res.returncode == 0, res.stderr

    kinds = [e["event"] for e in events]
    assert kinds[-2:] == ["artifact", "done"]

    artifact = next(e for e in events if e["event"] == "artifact")
    bundle = Path(artifact["path"]).parent
    metadata = json.loads((bundle / "metadata.json").read_text())
    # the materializer derived the wanted words from the dataset's positive role
    assert metadata["params"]["datasets"] == "ds-1"
    assert metadata["params"]["wantedWords"] == "hey_studio"
    # upstream folded: _silence_/_unknown_ + the positive label
    assert json.loads((bundle / "labels.json").read_text()) == ["_silence_", "_unknown_", "hey_studio"]
    provenance = json.loads((bundle / "provenance.json").read_text())
    assert provenance["sourceData"][0]["name"] == "edge-tts synthetic"


def test_read_params_datasets_env():
    from train_adapter import read_params

    params = read_params({"STREAM_DATASETS": "ds-1,ds-2"})
    assert params["datasets"] == "ds-1,ds-2"
    # defaults stay for the legacy source selector (back-compat)
    assert params["dataSource"] == "speech-commands-v2"


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


def test_tf_drift_guard_fails_loudly(tmp_path):
    """ADR-038 (#170): with the TF drift guard enabled and no TensorFlow in the
    upstream python, the adapter must fail loudly (exit 1 + error event) before
    training instead of silently running on a different TF. Uses a nonexistent
    python so the probe is deterministic regardless of the local env."""
    work = tmp_path / "work"
    work.mkdir()
    res, events = run_adapter(
        work,
        FAKE_UPSTREAM,
        tmp_path / "out",
        env={"UPSTREAM_PYTHON": "/nonexistent/venv/bin/python"},
        skip_tf_guard=False,
    )
    assert res.returncode == 1
    errors = [e for e in events if e.get("event") == "error"]
    assert errors, "expected an NDJSON error event from the TF drift guard"
    assert "TensorFlow" in errors[0]["message"]


def test_default_upstream_dir_resolves_vendored():
    """ADR-037 Tier 3 (#156): the default must find third_party/kws_streaming.

    Every other test pins UPSTREAM_DIR to the fake upstream; this one guards
    the vendored import itself - it fails if the vendor is deleted, relocated,
    or loses train/model_train_eval.py.
    """
    from train_adapter import default_upstream_dir

    resolved = default_upstream_dir()
    assert (resolved / "kws_streaming" / "train" / "model_train_eval.py").is_file()


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


def test_prepare_data_mixed_edge_tts_plus_sc2(monkeypatch, tmp_path):
    """Mixed mode: TTS positives + SC2 negatives merge, wanted = phrases."""
    import train_adapter

    class FakeDs:
        @staticmethod
        def build_edge_tts_kws_dataset(phrases, languages, out, samples_per_phrase=3,
                                       unknown_words=None, sample_rate=16000,
                                       voices=None, reporter=None):
            (out / "hey_studio").mkdir(parents=True, exist_ok=True)
            return {"name": "edge-tts", "commercialUse": True}

        @staticmethod
        def prepare_speech_commands_v2(data_dir, reporter=None):
            (data_dir / "yes").mkdir(parents=True, exist_ok=True)
            (data_dir / "_background_noise_").mkdir(exist_ok=True)
            return data_dir, {"name": "sc2", "commercialUse": True}

        @staticmethod
        def merge_label_trees(positive_root, negative_root, out_dir):
            (out_dir / "hey_studio").mkdir(parents=True, exist_ok=True)
            (out_dir / "yes").mkdir()
            return out_dir

    monkeypatch.setattr(train_adapter, "_import_data_sources", lambda: FakeDs)
    params = train_adapter.read_params(
        {
            "STREAM_DATA_SOURCE": "mixed",
            "STREAM_POSITIVE_SOURCE": "edge-tts",
            "STREAM_NEGATIVE_SOURCE": "speech-commands-v2",
            "STREAM_WAKE_PHRASES": "hey studio",
        }
    )

    class R:
        def emit(self, event, **fields):
            pass

    data_dir, sources, wanted = train_adapter.prepare_data(params, tmp_path, R())
    assert wanted == "hey_studio"
    assert len(sources) == 2
    assert sources[0]["commercialUse"] is True  # edge-tts
    assert sources[1]["commercialUse"] is True  # sc2
    assert (Path(data_dir) / "hey_studio").is_dir()
    assert (Path(data_dir) / "yes").is_dir()


def test_prepare_data_mixed_negative_none(monkeypatch, tmp_path):
    """Mixed mode with negativeSource=none keeps only TTS positives."""
    import train_adapter

    class FakeDs:
        @staticmethod
        def build_edge_tts_kws_dataset(phrases, languages, out, samples_per_phrase=3,
                                       unknown_words=None, sample_rate=16000,
                                       voices=None, reporter=None):
            (out / "hey_studio").mkdir(parents=True, exist_ok=True)
            (out / "_background_noise_").mkdir(exist_ok=True)
            return {"name": "edge-tts", "commercialUse": True}

        @staticmethod
        def merge_label_trees(positive_root, negative_root, out_dir):
            assert negative_root is None
            (out_dir / "hey_studio").mkdir(parents=True, exist_ok=True)
            return out_dir

    monkeypatch.setattr(train_adapter, "_import_data_sources", lambda: FakeDs)
    params = train_adapter.read_params(
        {
            "STREAM_DATA_SOURCE": "mixed",
            "STREAM_NEGATIVE_SOURCE": "none",
            "STREAM_WAKE_PHRASES": "hey studio",
        }
    )

    class R:
        def emit(self, event, **fields):
            pass

    data_dir, sources, wanted = train_adapter.prepare_data(params, tmp_path, R())
    assert wanted == "hey_studio"
    assert len(sources) == 1
    assert (Path(data_dir) / "hey_studio").is_dir()
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

