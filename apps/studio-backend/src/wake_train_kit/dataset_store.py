"""wake_train_kit.dataset_store — the backend `datasets/` store (ADR-044, #204).

Mirrors the artifacts store (`wake_training_service/store.py` + `manager.py`):
a durable `datasets/<id>/wake-studio-dataset.zip` directory + a SQLite index
(sha256, size, manifest). Datasets are FIRST-CLASS artifacts — they survive
service restarts and are not tied to the job that produced them.

This module lives in `wake_train_kit` (the data layer) so both the service
(`wake_training_service`) and the `dataset-generate` / `dataset-storage`
subprocess runners can use it without a layering cycle (the kit must not
import the service).

Canonical layout (docs/modules/data-sources.md §4.1)::

    datasets/
    ├── <dataset-id>/
    │   └── wake-studio-dataset.zip
    └── datasets.db              <- SQLite index (id -> stored_path, sha256, ...)

The zip is imported through `wake_train_kit.dataset.import_dataset_zip`, so a
dataset only lands in the store when its manifest is valid and every declared
label has >= 1 clip.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import sqlite3
import threading
import zipfile
from pathlib import Path
from typing import Any, TypedDict

from .dataset import DatasetManifest, import_dataset_zip

SCHEMA = """
CREATE TABLE IF NOT EXISTS datasets (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  version       INTEGER NOT NULL,
  kind          TEXT NOT NULL,
  role          TEXT NOT NULL,
  stored_path   TEXT NOT NULL,
  sha256        TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL,
  manifest      TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL
);
"""


class DatasetRecord(TypedDict):
    id: str
    name: str
    version: int
    kind: str
    role: str
    stored_path: str
    sha256: str
    size_bytes: int
    manifest: dict[str, Any]
    created_at_ms: int


class DatasetStoreError(RuntimeError):
    """Raised on store-level failures (unknown dataset, persistence problems)."""


class DatasetStore:
    """Thread-safe, SQLite-backed persistence for first-class datasets.

    ``save`` imports a canonical ``wake-studio-dataset.zip`` (validates the
    manifest + clip tree), copies it into ``datasets/<id>/`` and registers the
    record (sha256 over the stored zip). ``get`` / ``list`` / ``delete`` /
    ``path`` read from the same index. The index survives restarts.
    """

    def __init__(self, datasets_dir: str | Path, db_path: str | Path | None = None) -> None:
        self.datasets_dir = Path(datasets_dir)
        self.datasets_dir.mkdir(parents=True, exist_ok=True)
        self.db_path = Path(db_path) if db_path else self.datasets_dir / "datasets.db"
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(str(self.db_path), check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.executescript(SCHEMA)
        self._conn.commit()

    def close(self) -> None:
        with self._lock:
            self._conn.close()

    # --- public API ---------------------------------------------------------
    def save(self, zip_path: str | Path) -> DatasetRecord:
        """Import + persist a canonical dataset zip.

        Validates via ``import_dataset_zip`` (raises ValueError on an invalid
        manifest), copies the zip to ``datasets/<id>/wake-studio-dataset.zip``,
        and upserts the index. Returns the stored record.
        """
        src = Path(zip_path)
        if not src.is_file():
            raise DatasetStoreError(f"dataset zip not found: {src}")

        try:
            manifest, _clips = import_dataset_zip(src)
        except (ValueError, zipfile.BadZipFile) as exc:
            raise DatasetStoreError(f"invalid dataset zip '{src.name}': {exc}") from exc
        dataset_id = str(manifest["id"])
        dest_dir = self.datasets_dir / dataset_id
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest = dest_dir / "wake-studio-dataset.zip"
        shutil.copy2(src, dest)
        data = dest.read_bytes()
        record = self._record_from_manifest(manifest, dest, data)
        self._upsert(record)
        return record

    def get(self, dataset_id: str) -> DatasetRecord | None:
        with self._lock:
            row = self._conn.execute(
                "SELECT * FROM datasets WHERE id = ?", (dataset_id,)
            ).fetchone()
        return self._row_to_record(row) if row else None

    def list(self) -> list[DatasetRecord]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT * FROM datasets ORDER BY created_at_ms DESC"
            ).fetchall()
        return [self._row_to_record(r) for r in rows]

    def delete(self, dataset_id: str) -> None:
        with self._lock:
            row = self._conn.execute(
                "SELECT stored_path FROM datasets WHERE id = ?", (dataset_id,)
            ).fetchone()
            if row is not None:
                stored = Path(row["stored_path"])
                stored.unlink(missing_ok=True)
                shutil.rmtree(stored.parent, ignore_errors=True)
            self._conn.execute("DELETE FROM datasets WHERE id = ?", (dataset_id,))
            self._conn.commit()

    def path(self, dataset_id: str) -> Path | None:
        """Local path of a dataset's canonical zip (None when unknown)."""
        record = self.get(dataset_id)
        if record is None:
            return None
        return Path(record["stored_path"])

    def load_manifest(self, dataset_id: str) -> DatasetManifest | None:
        """The parsed manifest of a stored dataset (None when unknown)."""
        record = self.get(dataset_id)
        if record is None:
            return None
        return record["manifest"]  # type: ignore[return-value]

    # --- internals ----------------------------------------------------------
    def _record_from_manifest(
        self, manifest: DatasetManifest, stored: Path, data: bytes
    ) -> DatasetRecord:
        import time

        return {
            "id": str(manifest["id"]),
            "name": str(manifest["name"]),
            "version": int(manifest.get("version", 1)),
            "kind": str(manifest.get("kind", "uploaded")),
            "role": str(manifest.get("role", "mixed")),
            "stored_path": str(stored),
            "sha256": hashlib.sha256(data).hexdigest(),
            "size_bytes": len(data),
            "manifest": manifest,
            "created_at_ms": int(manifest.get("createdAtMs") or time.time() * 1000),
        }

    def _upsert(self, record: DatasetRecord) -> None:
        with self._lock:
            self._conn.execute(
                "INSERT INTO datasets (id, name, version, kind, role, stored_path,"
                " sha256, size_bytes, manifest, created_at_ms)"
                " VALUES (:id, :name, :version, :kind, :role, :stored_path,"
                " :sha256, :size_bytes, :manifest, :created_at_ms)"
                " ON CONFLICT(id) DO UPDATE SET name=excluded.name,"
                " version=excluded.version, kind=excluded.kind, role=excluded.role,"
                " stored_path=excluded.stored_path, sha256=excluded.sha256,"
                " size_bytes=excluded.size_bytes, manifest=excluded.manifest,"
                " created_at_ms=excluded.created_at_ms",
                self._record_to_row(record),
            )
            self._conn.commit()

    @staticmethod
    def _record_to_row(record: DatasetRecord) -> dict[str, Any]:
        return {
            **{k: v for k, v in record.items() if k != "manifest"},
            "manifest": json.dumps(record["manifest"]),
        }

    @staticmethod
    def _row_to_record(row: sqlite3.Row) -> DatasetRecord:
        record = dict(row)
        record["manifest"] = json.loads(record["manifest"])
        return record  # type: ignore[return-value]
