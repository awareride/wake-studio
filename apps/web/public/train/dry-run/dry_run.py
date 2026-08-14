#!/usr/bin/env python3
"""Dry-run trainer (demo module) — instant fake training for local
web-function checks (no GPU, no upstream repo, no data download).

Runs in ~1s and produces a **standard bundle zip** (docs/modules/training.md
§6), so the full PWA training flow — wizard submit → live status (progress /
metrics / log tail) → artifact download — can be exercised against a local
studio-backend (`uv run wake-service` with the default registry).

Emits the NDJSON reporting protocol (§4.4) on stdout: log, progress (per
step), metrics, heartbeat, artifact (the bundle zip), done.

Params (env, the registry maps job params to these):
    WAKE_PHRASE  WAKE_STEPS  WAKE_JOB_ID  WAKE_BACKEND  WORK_DIR  OUT_DIR
"""

from __future__ import annotations

import json
import os
import time
import zipfile
from pathlib import Path
from typing import Any

try:  # the service's reporter (installed with wake-service)
    from wake_train_kit.report import Reporter
except ImportError:  # standalone fallback
    class Reporter:  # type: ignore[no-redef]
        def emit(self, event: str, **fields: Any) -> None:
            print(json.dumps({"event": event, **fields}), flush=True)


def build_bundle(phrase: str, steps: int, job_id: str, backend: str,
                 out_dir: Path, reporter: Reporter) -> Path:
    """Standard bundle (§6): model + metrics/metadata/provenance/config + zip."""
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "model.onnx").write_bytes(
        b"dry-run-model:" + phrase.encode("utf-8") + b"\x00"
    )

    metrics = {
        "status": "ok",
        "note": "fake metrics from the dry-run demo trainer",
        "recall": 0.97,
        "accuracy": 0.98,
        "false_positives_per_hour": 0.2,
        "steps": steps,
    }
    (out_dir / "metrics.json").write_text(json.dumps(metrics, indent=2), encoding="utf-8")

    metadata = {
        "jobId": job_id,
        "moduleId": "dry-run",
        "backend": backend,
        "provider": backend,
        "params": {"wakePhrase": phrase, "epochs": str(steps)},
        "trainedAtMs": int(time.time() * 1000),
    }
    (out_dir / "metadata.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")

    provenance = {
        "license": "user-owned",
        "sourceData": [{"name": "dry-run demo data", "license": "MIT", "source": "wake-studio"}],
        "notes": "Fake model produced by the dry-run demo trainer — for testing the web flow only.",
    }
    (out_dir / "provenance.json").write_text(json.dumps(provenance, indent=2), encoding="utf-8")

    config = {"wakePhrase": phrase, "backend": backend, "steps": steps,
              "model_type": "dnn", "layer_size": 32}
    (out_dir / "config.json").write_text(json.dumps(config, indent=2), encoding="utf-8")

    zip_path = out_dir / "wake-studio-results.zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for name in ("model.onnx", "metrics.json", "metadata.json",
                     "provenance.json", "config.json"):
            p = out_dir / name
            if p.is_file():
                zf.write(p, arcname=f"{job_id}/{name}")
    reporter.emit("log", level="info", message=f"bundle ready: {zip_path}")
    return zip_path


def main(argv: list[str] | None = None) -> int:
    reporter = Reporter()
    phrase = os.environ.get("WAKE_PHRASE", "") or "hey studio"
    raw_steps = os.environ.get("WAKE_STEPS", "")
    steps = int(raw_steps) if raw_steps else 5
    job_id = os.environ.get("WAKE_JOB_ID", "") or f"dry-run-{int(time.time() * 1000)}"
    backend = os.environ.get("WAKE_BACKEND", "") or "self-hosted"
    work = Path(os.environ.get("WORK_DIR", ".")).resolve()
    out = Path(os.environ.get("OUT_DIR", work / "wake-studio-results")) / job_id

    reporter.emit("log", level="info",
                  message=f"dry-run: phrase={phrase!r} steps={steps} backend={backend}")
    for i in range(1, steps + 1):
        time.sleep(0.05)
        reporter.emit("progress", step=i, total=steps, progress=i / steps,
                      message=f"fake step {i}")
        reporter.emit("metrics", loss=round(1.0 / i, 4) if i else 0.0, step=i)
        if i % 2 == 0:
            reporter.emit("heartbeat")

    try:
        zip_path = build_bundle(phrase, steps, job_id, backend, out, reporter)
    except Exception as exc:  # noqa: BLE001
        reporter.emit("error", message=f"bundle error: {exc}")
        return 1

    reporter.emit("artifact", path=str(zip_path))
    reporter.emit("done", exitCode=0)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
