"""Dry-run demo trainer tests — the script must emit the NDJSON protocol and
produce a standard bundle zip (docs/modules/training.md §6) without any
external deps, GPU or network."""

import json
import os
import subprocess
import sys
import zipfile
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / "dry_run.py"


def run(tmp_path: Path, **env_extra: str):
    work = tmp_path / "work"
    work.mkdir()
    out = tmp_path / "out"
    env = {
        **os.environ,
        "WORK_DIR": str(work),
        "OUT_DIR": str(out),
        "WAKE_PHRASE": "hey studio",
        "WAKE_STEPS": "3",
        "WAKE_BACKEND": "self-hosted",
        **env_extra,
    }
    res = subprocess.run(
        [sys.executable, str(SCRIPT)], cwd=str(work), env=env,
        capture_output=True, text=True, timeout=60,
    )
    events = [
        json.loads(line)
        for line in res.stdout.splitlines()
        if line.startswith("{")
    ]
    return res, events


def test_dry_run_end_to_end(tmp_path):
    res, events = run(tmp_path)
    assert res.returncode == 0, res.stderr

    kinds = [e["event"] for e in events]
    assert kinds[0] == "log"
    assert "progress" in kinds
    assert kinds[-2:] == ["artifact", "done"]

    artifact = next(e for e in events if e["event"] == "artifact")
    zip_path = Path(artifact["path"])
    assert zip_path.is_file()

    with zipfile.ZipFile(zip_path) as zf:
        names = zf.namelist()
    assert any(n.endswith("model.onnx") for n in names)
    assert any(n.endswith("wake-studio-results.zip") is False for n in names)  # sanity

    with zipfile.ZipFile(zip_path) as zf:
        meta = json.loads(zf.read(next(n for n in names if n.endswith("metadata.json"))))
    assert meta["moduleId"] == "dry-run"
    assert meta["backend"] == "self-hosted"
    assert meta["params"]["wakePhrase"] == "hey studio"


def test_dry_run_defaults_and_progress(tmp_path):
    res, events = run(tmp_path, WAKE_STEPS="", WAKE_PHRASE="")
    assert res.returncode == 0
    progress = [e for e in events if e["event"] == "progress"]
    assert len(progress) == 5  # default steps
    assert progress[-1]["progress"] == 1.0
    metrics = [e for e in events if e["event"] == "metrics"]
    assert len(metrics) == 5
