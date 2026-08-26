"""wake_train_kit.check_runner — dataset-check job entry (ADR-044 §9, #209).

Registry entry (engine "direct") for the studio-backend job manager (ADR-036).
Reads job params from CHECK_* env vars + WAKE_PARAMS JSON (the registry
convention), loads a dataset (by store id or by direct zip path), runs the
quality gate (`wake_train_kit.quality.check_dataset`) and reports:

- a ``health`` NDJSON event with the FULL health report (the Datasets console
  parses it from the job log for live display),
- a ``wake-studio-dataset-health.json`` artifact (durable copy),
- a quality-annotated ``wake-studio-dataset.zip``: the manifest gains
  ``quality`` = verdict + warnings (AC: warnings travel in the manifest);
  any silent change bumps the dataset ``version`` (reproducibility rule).

The job exits 0 whenever the check RAN (a ``fail`` verdict is a report, not a
job failure); the console/UI decides what to block.
"""

from __future__ import annotations

import json
import os
import shutil
import sys
import zipfile
from pathlib import Path
from typing import Any

from wake_train_kit.dataset import import_dataset_zip, pack_dataset_zip
from wake_train_kit.quality import QualityError, check_dataset, quality_summary

try:
    from wake_train_kit.report import Reporter
except ImportError:  # standalone fallback: plain NDJSON prints
    class Reporter:  # type: ignore[no-redef]
        def emit(self, event: str, **fields: Any) -> None:
            print(json.dumps({"event": event, **fields}), flush=True)


DEFAULTS: dict[str, Any] = {
    "datasetId": "",   # dataset from the durable datasets/ store
    "src": "",         # direct path to a wake-studio-dataset.zip (dev/tests)
}

ENV_MAP: dict[str, str] = {
    "CHECK_DATASET_ID": "datasetId",
    "CHECK_SRC": "src",
}


def read_params(env: dict[str, str] | None = None) -> dict[str, Any]:
    env = env if env is not None else os.environ
    params: dict[str, Any] = dict(DEFAULTS)

    raw_json = env.get("WAKE_PARAMS", "")
    if raw_json:
        try:
            for key, value in json.loads(raw_json).items():
                if key in DEFAULTS:
                    params[key] = value
        except (ValueError, TypeError):
            pass

    for var, key in ENV_MAP.items():
        raw = env.get(var, "")
        if raw != "":
            params[key] = raw
    return params


def resolve_dataset_zip(
    params: dict[str, Any],
    work_dir: Path,
) -> Path:
    """The canonical zip path for the job target (store id or direct src)."""
    src = params.get("src")
    if src:
        path = Path(src)
        if not path.is_absolute():
            path = (work_dir / path).resolve()
        return path

    dataset_id = params.get("datasetId")
    if not dataset_id:
        raise QualityError("dataset-check requires a datasetId or src")

    from wake_train_kit.materialize import open_dataset_store

    record = open_dataset_store().get(dataset_id)
    if record is None:
        raise QualityError(
            f"dataset '{dataset_id}' is not in the backend store "
            "(run a dataset-generate job first)"
        )
    return Path(record["stored_path"])


def extract_zip(zip_path: Path, dest: Path) -> Path:
    """Safe zip extraction (zip-slip guarded) -> the canonical `audio/` root."""
    dest = Path(dest)
    dest.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path) as zf:
        for member in zf.namelist():
            target = (dest / member).resolve()
            if not str(target).startswith(str(dest.resolve())):
                raise QualityError(f"dataset zip contains an unsafe path: {member}")
        zf.extractall(dest)
    return dest / "audio"


def main(argv: list[str] | None = None) -> int:
    reporter = Reporter()
    params = read_params()
    work_dir = Path(os.environ.get("WORK_DIR", ".")).resolve()

    reporter.emit(
        "log", level="info",
        message=f"dataset-check: datasetId={params['datasetId'] or '-'} "
                f"src={params['src'] or '-'}",
    )

    try:
        zip_path = resolve_dataset_zip(params, work_dir)
        if not zip_path.is_file():
            raise QualityError(f"dataset zip not found: {zip_path}")

        manifest, _clips = import_dataset_zip(zip_path)
        extract_root = work_dir / "check-extract"
        if extract_root.exists():
            shutil.rmtree(extract_root)
        audio_root = extract_zip(zip_path, extract_root)

        report = check_dataset(audio_root, manifest)
        reporter.emit("health", report=report)

        # durable full report artifact
        report_path = work_dir / "wake-studio-dataset-health.json"
        report_path.write_text(json.dumps(report, ensure_ascii=False), encoding="utf-8")
        reporter.emit("artifact", path=str(report_path))

        # quality-annotated dataset zip (manifest.quality + version bump)
        annotated = dict(manifest)
        annotated["quality"] = quality_summary(report)
        annotated["version"] = int(manifest.get("version", 1)) + 1
        out_zip = work_dir / "wake-studio-dataset.zip"
        pack_dataset_zip(audio_root, annotated, out_zip)
        reporter.emit("artifact", path=str(out_zip))

        reporter.emit(
            "log", level="info",
            message=f"dataset-check: verdict={report['verdict']} "
                    f"warnings={len(report['warnings'])}",
        )
        reporter.emit("done", exitCode=0)
        return 0
    except Exception as exc:  # noqa: BLE001
        reporter.emit("error", message=f"dataset-check failed: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())