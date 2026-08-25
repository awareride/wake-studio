"""wake_train_kit.split_runner — dataset-split job entry (ADR-044 §9, #209).

Registry entry (engine "direct") for the studio-backend job manager (ADR-036).
Reads job params from SPLIT_* env vars + WAKE_PARAMS JSON (the registry
convention), loads a dataset (store id or direct zip), computes a
REPRODUCIBLE train/val/test partition and emits a NEW canonical dataset zip
whose manifest records the partition:

    split: {"seed": N, "ratios": [r_train, r_val, r_test],
            "train": ["audio/<label>/<clip>", ...], "val": [...], "test": [...]}

Every backend materializes the same split (docs/modules/data-sources.md §9.3);
near-duplicate clips stay in ONE partition, so train/eval cannot leak
(quality.py `split_dataset`). The split dataset is a new first-class dataset:
new id, ``recipe.split.parentId`` pointing at the source dataset. The manager
persists the emitted ``wake-studio-dataset.zip`` into the durable store
automatically.
"""

from __future__ import annotations

import json
import os
import shutil
import sys
import uuid
import zipfile
from pathlib import Path
from typing import Any

from wake_train_kit.dataset import pack_dataset_zip
from wake_train_kit.quality import QualityError, split_dataset

try:
    from wake_train_kit.report import Reporter
except ImportError:  # standalone fallback: plain NDJSON prints
    class Reporter:  # type: ignore[no-redef]
        def emit(self, event: str, **fields: Any) -> None:
            print(json.dumps({"event": event, **fields}), flush=True)


DEFAULTS: dict[str, Any] = {
    "datasetId": "",               # source dataset from the durable store
    "src": "",                     # direct path to a wake-studio-dataset.zip
    "seed": "0",                   # reproducibility seed (recipe.seed parity)
    "ratios": "0.8,0.1,0.1",       # train,val,test
}

ENV_MAP: dict[str, str] = {
    "SPLIT_DATASET_ID": "datasetId",
    "SPLIT_SRC": "src",
    "SPLIT_SEED": "seed",
    "SPLIT_RATIOS": "ratios",
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


def _parse_ratios(raw: str) -> tuple[float, float, float]:
    parts = [float(p.strip()) for p in raw.split(",") if p.strip()]
    if len(parts) != 3 or any(p < 0 for p in parts) or not any(parts):
        raise QualityError(
            f"split ratios must be train,val,test numbers (got {raw!r})"
        )
    total = sum(parts)
    return (parts[0] / total, parts[1] / total, parts[2] / total)


def resolve_dataset_zip(params: dict[str, Any], work_dir: Path) -> Path:
    src = params.get("src")
    if src:
        path = Path(src)
        if not path.is_absolute():
            path = (work_dir / path).resolve()
        return path
    dataset_id = params.get("datasetId")
    if not dataset_id:
        raise QualityError("dataset-split requires a datasetId or src")
    from wake_train_kit.materialize import open_dataset_store

    record = open_dataset_store().get(dataset_id)
    if record is None:
        raise QualityError(
            f"dataset '{dataset_id}' is not in the backend store "
            "(run a dataset-generate job first)"
        )
    return Path(record["stored_path"])


def extract_zip(zip_path: Path, dest: Path) -> Path:
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

    try:
        ratios = _parse_ratios(str(params.get("ratios") or "0.8,0.1,0.1"))
        seed = int(params.get("seed") or 0)
    except (TypeError, ValueError, QualityError) as exc:
        reporter.emit("error", message=f"dataset-split failed: {exc}")
        return 1
    reporter.emit(
        "log", level="info",
        message=f"dataset-split: datasetId={params['datasetId'] or '-'} "
                f"seed={seed} ratios={ratios}",
    )

    try:
        zip_path = resolve_dataset_zip(params, work_dir)
        if not zip_path.is_file():
            raise QualityError(f"dataset zip not found: {zip_path}")

        from wake_train_kit.dataset import import_dataset_zip

        manifest, _clips = import_dataset_zip(zip_path)
        extract_root = work_dir / "split-extract"
        if extract_root.exists():
            shutil.rmtree(extract_root)
        audio_root = extract_zip(zip_path, extract_root)

        split_manifest, partitions = split_dataset(
            audio_root, manifest, seed=seed, ratios=ratios
        )

        # a split dataset is a NEW first-class dataset: new id, version 1,
        # recipe.split records the parent + seed for provenance.
        parent_id = str(manifest.get("id"))
        split_manifest = dict(split_manifest)
        split_manifest["id"] = str(uuid.uuid4())
        split_manifest["version"] = 1
        split_manifest["name"] = f"{manifest.get('name', 'dataset')} (split)"
        split_manifest["storage"] = {
            "backend": f"datasets/{split_manifest['id']}/",
        }
        recipe = dict(split_manifest.get("recipe") or {})
        recipe["split"] = {
            "parentId": parent_id,
            "seed": seed,
        }
        split_manifest["recipe"] = recipe

        out_zip = work_dir / "wake-studio-dataset.zip"
        pack_dataset_zip(audio_root, split_manifest, out_zip)

        counts = {k: len(v) for k, v in partitions.items()}
        reporter.emit(
            "log", level="info",
            message=f"dataset-split: train={counts['train']} val={counts['val']} "
                    f"test={counts['test']} seed={seed}",
        )
        reporter.emit("artifact", path=str(out_zip))
        reporter.emit("done", exitCode=0, split=counts)
        return 0
    except Exception as exc:  # noqa: BLE001
        reporter.emit("error", message=f"dataset-split failed: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())