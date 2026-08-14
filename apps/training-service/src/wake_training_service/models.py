"""Job model + state machine (ADR-036)."""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any


def now_ms() -> int:
    return int(time.time() * 1000)


class JobStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    PAUSED = "paused"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELED = "canceled"


#: statuses in which the job still owns resources / a queue slot
ACTIVE = frozenset({JobStatus.QUEUED, JobStatus.RUNNING, JobStatus.PAUSED})
#: transitions allowed per action (source statuses)
CAN_START = frozenset({JobStatus.QUEUED, JobStatus.PAUSED})
CAN_PAUSE = frozenset({JobStatus.RUNNING})
CAN_CANCEL = frozenset({JobStatus.QUEUED, JobStatus.RUNNING, JobStatus.PAUSED})

MAX_LOG_LINES = 500


@dataclass
class Job:
    id: str
    module_id: str
    params: dict[str, str] = field(default_factory=dict)
    status: JobStatus = JobStatus.QUEUED
    progress: float | None = None
    metrics: dict[str, float] = field(default_factory=dict)
    error: str | None = None
    exit_code: int | None = None
    created_at_ms: int = field(default_factory=now_ms)
    updated_at_ms: int = 0
    started_at_ms: int | None = None
    finished_at_ms: int | None = None
    pid: int | None = None
    log: list[str] = field(default_factory=list)
    checkpoint: str | None = None
    artifacts: list[str] = field(default_factory=list)  # artifact names (index keys)

    def touch(self) -> None:
        self.updated_at_ms = now_ms()

    def append_log(self, line: str) -> None:
        if len(self.log) >= MAX_LOG_LINES:
            self.log.pop(0)
        self.log.append(line)

    def set_status(self, status: JobStatus, error: str | None = None) -> None:
        self.status = status
        if error is not None:
            self.error = error
        if status in (JobStatus.RUNNING,):
            if self.started_at_ms is None:
                self.started_at_ms = now_ms()
        if status in (JobStatus.SUCCEEDED, JobStatus.FAILED, JobStatus.CANCELED):
            self.finished_at_ms = now_ms()
        self.touch()

    # --- persistence / API shapes ----------------------------------------
    def to_row(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "module_id": self.module_id,
            "params": json_dumps(self.params),
            "status": self.status.value,
            "progress": self.progress,
            "metrics": json_dumps(self.metrics),
            "error": self.error,
            "exit_code": self.exit_code,
            "created_at_ms": self.created_at_ms,
            "updated_at_ms": self.updated_at_ms,
            "started_at_ms": self.started_at_ms,
            "finished_at_ms": self.finished_at_ms,
            "pid": self.pid,
            "log": json_dumps(self.log),
            "checkpoint": self.checkpoint,
            "artifacts": json_dumps(self.artifacts),
        }

    @classmethod
    def from_row(cls, row: dict[str, Any]) -> "Job":
        return cls(
            id=row["id"],
            module_id=row["module_id"],
            params=json_loads(row["params"]),
            status=JobStatus(row["status"]),
            progress=row["progress"],
            metrics=json_loads(row["metrics"]),
            error=row["error"],
            exit_code=row["exit_code"],
            created_at_ms=row["created_at_ms"],
            updated_at_ms=row["updated_at_ms"],
            started_at_ms=row["started_at_ms"],
            finished_at_ms=row["finished_at_ms"],
            pid=row["pid"],
            log=json_loads(row["log"]),
            checkpoint=row["checkpoint"],
            artifacts=json_loads(row["artifacts"]),
        )

    def to_api(self) -> dict[str, Any]:
        """Wire shape (camelCase, matching docs/modules/training.md 2/3)."""
        return {
            "id": self.id,
            "moduleId": self.module_id,
            "params": self.params,
            "status": self.status.value,
            "progress": self.progress,
            "metrics": self.metrics,
            "logTail": self.log[-20:],
            "error": self.error,
            "exitCode": self.exit_code,
            "createdAtMs": self.created_at_ms,
            "updatedAtMs": self.updated_at_ms,
            "startedAtMs": self.started_at_ms,
            "finishedAtMs": self.finished_at_ms,
            "pid": self.pid,
            "checkpoint": self.checkpoint,
            "artifacts": self.artifacts,
        }


def json_dumps(obj: Any) -> str:
    import json
    return json.dumps(obj)


def json_loads(raw: str) -> Any:
    import json
    if not raw:
        return {}
    return json.loads(raw)
