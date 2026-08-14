"""SQLite job store - persistence across restarts (ADR-036 6)."""

from __future__ import annotations

import json
import sqlite3
import threading
from pathlib import Path
from typing import Any

from .models import Job, JobStatus

SCHEMA = """
CREATE TABLE IF NOT EXISTS jobs (
  id            TEXT PRIMARY KEY,
  module_id     TEXT NOT NULL,
  params        TEXT NOT NULL DEFAULT '{}',
  status        TEXT NOT NULL,
  progress      REAL,
  metrics       TEXT NOT NULL DEFAULT '{}',
  error         TEXT,
  exit_code     INTEGER,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  started_at_ms INTEGER,
  finished_at_ms INTEGER,
  pid           INTEGER,
  log           TEXT NOT NULL DEFAULT '[]',
  checkpoint    TEXT,
  artifacts     TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS artifacts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id      TEXT NOT NULL,
  name        TEXT NOT NULL,
  stored_path TEXT NOT NULL,
  sha256      TEXT NOT NULL,
  size_bytes  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_artifacts_job ON artifacts(job_id);
"""


class Store:
    """Thread-safe SQLite persistence for jobs + artifact index."""

    def __init__(self, db_path: str | Path) -> None:
        self.db_path = str(db_path)
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(self.db_path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.executescript(SCHEMA)
        self._conn.commit()

    def close(self) -> None:
        with self._lock:
            self._conn.close()

    # --- jobs -------------------------------------------------------------
    def create_job(self, job: Job) -> Job:
        job.touch()
        with self._lock:
            self._conn.execute(
                "INSERT INTO jobs (id, module_id, params, status, progress, metrics,"
                " error, exit_code, created_at_ms, updated_at_ms, started_at_ms,"
                " finished_at_ms, pid, log, checkpoint, artifacts)"
                " VALUES (:id, :module_id, :params, :status, :progress, :metrics,"
                " :error, :exit_code, :created_at_ms, :updated_at_ms, :started_at_ms,"
                " :finished_at_ms, :pid, :log, :checkpoint, :artifacts)",
                job.to_row(),
            )
            self._conn.commit()
        return job

    def get_job(self, job_id: str) -> Job | None:
        with self._lock:
            row = self._conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
        return Job.from_row(dict(row)) if row else None

    def list_jobs(self, limit: int = 200) -> list[Job]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT * FROM jobs ORDER BY created_at_ms DESC LIMIT ?", (limit,)
            ).fetchall()
        return [Job.from_row(dict(r)) for r in rows]

    def update_job(self, job: Job) -> None:
        job.touch()
        with self._lock:
            self._conn.execute(
                "UPDATE jobs SET module_id=:module_id, params=:params, status=:status,"
                " progress=:progress, metrics=:metrics, error=:error, exit_code=:exit_code,"
                " created_at_ms=:created_at_ms, updated_at_ms=:updated_at_ms,"
                " started_at_ms=:started_at_ms, finished_at_ms=:finished_at_ms,"
                " pid=:pid, log=:log, checkpoint=:checkpoint, artifacts=:artifacts"
                " WHERE id=:id",
                job.to_row(),
            )
            self._conn.commit()

    def delete_job(self, job_id: str) -> None:
        with self._lock:
            self._conn.execute("DELETE FROM artifacts WHERE job_id = ?", (job_id,))
            self._conn.execute("DELETE FROM jobs WHERE id = ?", (job_id,))
            self._conn.commit()

    def jobs_by_status(self, status: JobStatus) -> list[Job]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT * FROM jobs WHERE status = ?", (status.value,)
            ).fetchall()
        return [Job.from_row(dict(r)) for r in rows]

    # --- artifacts ----------------------------------------------------------
    def add_artifact(self, job_id: str, name: str, stored_path: str,
                     sha256: str, size_bytes: int) -> None:
        with self._lock:
            self._conn.execute(
                "INSERT INTO artifacts (job_id, name, stored_path, sha256, size_bytes)"
                " VALUES (?, ?, ?, ?, ?)",
                (job_id, name, stored_path, sha256, size_bytes),
            )
            self._conn.commit()

    def get_artifact(self, job_id: str, name: str) -> dict[str, Any] | None:
        with self._lock:
            row = self._conn.execute(
                "SELECT * FROM artifacts WHERE job_id = ? AND name = ?", (job_id, name)
            ).fetchone()
        return dict(row) if row else None

    def list_artifacts(self, job_id: str) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT * FROM artifacts WHERE job_id = ?", (job_id,)
            ).fetchall()
        return [dict(r) for r in rows]

    def all_artifacts(self) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._conn.execute("SELECT * FROM artifacts").fetchall()
        return [dict(r) for r in rows]

    def delete_artifacts(self, job_id: str) -> None:
        with self._lock:
            self._conn.execute("DELETE FROM artifacts WHERE job_id = ?", (job_id,))
            self._conn.commit()

    @staticmethod
    def serialize_json(obj: Any) -> str:
        return json.dumps(obj)
