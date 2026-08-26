"""check-dataset / dataset-split job runner tests (#209).

End-to-end-ish: build a canonical dataset zip in tmp, run the runner entry
(`main()`) with env vars like the job manager would, and assert the NDJSON
events + artifacts (health report, quality-annotated zip, split zip).
"""

from __future__ import annotations

import importlib
import json
import math
import os
import struct
import wave
from pathlib import Path

from wake_train_kit import check_runner, dataset as ds, split_runner


def phrase(freq: float, mod: float, rate: int = 16000) -> list[int]:
    out: list[int] = []
    for i in range(rate):
        t = i / rate
        env = 0.6 + 0.4 * math.sin(2 * math.pi * mod * t)
        s = env * (8000 * math.sin(2 * math.pi * freq * t)
                   + 0.4 * 8000 * math.sin(2 * math.pi * 2 * freq * t))
        out.append(int(s))
    return out


def make_wav(path: Path, samples: list[int]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes(b"".join(struct.pack("<h", min(32767, max(-32768, int(s)))) for s in samples))


def build_test_zip(tmp_path: Path, name: str = "wake-studio-dataset.zip") -> Path:
    """A 3-label canonical dataset zip (2 distinct positives + silence noise)."""
    root = tmp_path / "src-tree"
    make_wav(root / "hey_studio" / "a.wav", phrase(440, 3.0))
    make_wav(root / "hey_studio" / "b.wav", phrase(880, 5.0))
    make_wav(root / "goodbye" / "x.wav", phrase(220, 2.0))
    make_wav(root / "_background_noise_" / "n1.wav", [0] * 16000)
    manifest = {
        "schemaVersion": ds.DATASET_MANIFEST_SCHEMA_VERSION,
        "id": "ds-run-1",
        "name": "run-test",
        "version": 1,
        "kind": "generated",
        "role": "mixed",
        "audio": {"sampleRate": 16000, "channels": 1, "encoding": ds.CANONICAL_ENCODING,
                  "clips": 4, "durationSec": 4},
        "labels": [
            {"name": "hey_studio", "role": "positive", "source": "synthetic", "voices": ["en-US-1"]},
            {"name": "goodbye", "role": "unknown", "source": "synthetic"},
            {"name": "_background_noise_", "role": "noise", "source": "synthetic"},
        ],
        "provenance": [{"name": "test", "license": "user-owned", "commercialUse": True}],
        "recipe": {"engine": "edge-tts", "seed": 0, "toolVersions": {"edge-tts": "9.9.9"}},
        "contentHash": None,
        "storage": None,
        "quality": None,
        "split": None,
        "createdAtMs": 1,
    }
    zip_path = tmp_path / name
    ds.pack_dataset_zip(root, manifest, zip_path)
    return zip_path


def run_main(runner_module: str, env: dict[str, str], work_dir: Path) -> tuple[int, list[dict]]:
    """Run a runner's ``main()`` with patched env + in-memory Reporter.

    Returns ``(exit_code, captured NDJSON events)``.
    """
    mod = importlib.import_module(runner_module)
    captured: list[dict] = []

    class FakeReporter:
        def emit(self, event: str, **fields: object) -> None:
            captured.append({"event": event, **fields})

    old_reporter = mod.Reporter
    old_environ = dict(os.environ)
    try:
        mod.Reporter = FakeReporter  # type: ignore[assignment]
        os.environ.clear()
        os.environ.update(env)
        os.environ["WORK_DIR"] = str(work_dir)
        rc = mod.main([])
    finally:
        mod.Reporter = old_reporter
        os.environ.clear()
        os.environ.update(old_environ)
    return rc, captured


# ---------------------------------------------------------------------------
# manifest validation: quality + split (mirror of the web spec)
# ---------------------------------------------------------------------------

def test_manifest_quality_and_split_validation():
    manifest = {
        "schemaVersion": 1, "id": "d", "name": "n", "version": 1,
        "kind": "generated", "role": "mixed",
        "audio": {"sampleRate": 16000, "channels": 1, "encoding": ds.CANONICAL_ENCODING,
                  "clips": 1, "durationSec": 1},
        "labels": [{"name": "pos", "role": "positive"}],
        "provenance": [{"name": "p", "license": "l", "commercialUse": True}],
        "quality": {"checkedAtSec": 1, "verdict": "warn",
                    "warnings": [{"code": "silence", "severity": "warn", "message": "x"}]},
        "split": {"seed": 0, "ratios": [0.8, 0.1, 0.1],
                  "train": ["audio/pos/a.wav"], "val": [], "test": []},
    }
    ok, errors = ds.validate_dataset_manifest(manifest)
    assert ok, errors

    bad_verdict = dict(manifest)
    bad_verdict["quality"] = {"verdict": "nope", "warnings": []}
    assert not ds.validate_dataset_manifest(bad_verdict)[0]

    bad_ratios = dict(manifest)
    bad_ratios["split"] = {"seed": "0", "ratios": [0.8, 0.1],
                           "train": ["audio/pos/a.wav"], "val": [], "test": []}
    assert not ds.validate_dataset_manifest(bad_ratios)[0]

    overlap = dict(manifest)
    overlap["split"] = {"seed": 0, "ratios": [0.8, 0.1, 0.1],
                        "train": ["audio/pos/a.wav"], "val": ["audio/pos/a.wav"], "test": []}
    assert not ds.validate_dataset_manifest(overlap)[0]


# ---------------------------------------------------------------------------
# check-dataset runner
# ---------------------------------------------------------------------------

def test_check_runner_emits_health_and_quality_annotated_zip(tmp_path):
    zip_path = build_test_zip(tmp_path)
    work = tmp_path / "work"
    work.mkdir()

    rc, events = run_main("wake_train_kit.check_runner", {"CHECK_SRC": str(zip_path)}, work)
    assert rc == 0

    health = next(e for e in events if e["event"] == "health")
    report = health["report"]
    assert report["verdict"] in ("pass", "warn", "fail")
    assert report["labels"]["hey_studio"]["clips"] == 2
    assert report["labels"]["hey_studio"]["voices"] == 1  # manifest voice metadata

    # full report artifact
    assert (work / "wake-studio-dataset-health.json").is_file()

    # quality-annotated zip: manifest.quality + version bumped
    annotated_zip = work / "wake-studio-dataset.zip"
    assert annotated_zip.is_file()
    annotated_manifest, _ = ds.import_dataset_zip(annotated_zip)
    assert annotated_manifest["version"] == 2
    assert annotated_manifest["quality"]["verdict"] == report["verdict"]
    assert annotated_manifest["quality"]["warnings"] == report["warnings"]
    assert annotated_manifest["contentHash"]  # recomputed on the annotated payload


def test_check_runner_without_target_fails_cleanly(tmp_path):
    work = tmp_path / "work"
    work.mkdir()
    rc, events = run_main("wake_train_kit.check_runner", {}, work)
    assert rc == 1
    assert any(e["event"] == "error" for e in events)


# ---------------------------------------------------------------------------
# dataset-split runner
# ---------------------------------------------------------------------------

def test_split_runner_produces_split_dataset_zip(tmp_path):
    zip_path = build_test_zip(tmp_path)
    work = tmp_path / "work"
    work.mkdir()

    rc, events = run_main(
        "wake_train_kit.split_runner",
        {"SPLIT_SRC": str(zip_path), "SPLIT_SEED": "7", "SPLIT_RATIOS": "0.8,0.1,0.1"},
        work,
    )
    assert rc == 0

    out_zip = work / "wake-studio-dataset.zip"
    assert out_zip.is_file()
    manifest, _ = ds.import_dataset_zip(out_zip)

    split = manifest["split"]
    assert split["seed"] == 7
    assert split["ratios"] == [0.8, 0.1, 0.1]
    partitions = {"train": set(split["train"]), "val": set(split["val"]), "test": set(split["test"])}
    assert sum(len(v) for v in partitions.values()) == 4  # every clip in exactly one partition
    assert manifest["id"] != "ds-run-1"  # split = a new dataset
    assert manifest["recipe"]["split"]["parentId"] == "ds-run-1"
    assert manifest["name"].endswith("(split)")

    done = next(e for e in events if e["event"] == "done")
    assert sum(done.get("split", {}).values()) == 4


def test_split_runner_rejects_bad_ratios(tmp_path):
    zip_path = build_test_zip(tmp_path)
    work = tmp_path / "work"
    work.mkdir()
    rc, events = run_main(
        "wake_train_kit.split_runner",
        {"SPLIT_SRC": str(zip_path), "SPLIT_SEED": "0", "SPLIT_RATIOS": "1,2"},
        work,
    )
    assert rc == 1
    assert any(e["event"] == "error" for e in events)


# ---------------------------------------------------------------------------
# registry wiring
# ---------------------------------------------------------------------------

def test_registry_has_check_and_split_entries():
    registry_path = Path(__file__).resolve().parents[1] / "registry.json"
    entries = json.loads(registry_path.read_text())
    assert entries["dataset-check"]["entry"] == "check_runner.py"
    assert entries["dataset-split"]["entry"] == "split_runner.py"
    assert entries["dataset-check"]["env"]["CHECK_DATASET_ID"] == "{params.datasetId}"
    assert entries["dataset-split"]["env"]["SPLIT_SEED"] == "{params.seed}"