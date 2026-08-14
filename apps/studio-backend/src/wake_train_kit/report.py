"""NDJSON reporting protocol (docs/modules/training.md 4.4, ADR-036).

Module train scripts (or adapters wrapping upstream scripts) emit one JSON
object per line on stdout; the studio-backend reads the pipe line-by-line
and updates the job. This reporter is the reference implementation so
module-owned scripts get the contract for free.
"""

from __future__ import annotations

import json
import sys
from typing import Any, TextIO


class Reporter:
    """Writes NDJSON report lines to a stream (stdout by default)."""

    def __init__(self, out: TextIO | None = None, flush: bool = True) -> None:
        self.out = out if out is not None else sys.stdout
        self.flush = flush

    def emit(self, event: str, **fields: Any) -> None:
        payload = {"event": event, **fields}
        self.out.write(json.dumps(payload) + "\n")
        if self.flush:
            self.out.flush()

    # --- contract events (docs/modules/training.md 4.4) -------------------
    def progress(self, step: int | None = None, total: int | None = None,
                 progress: float | None = None, message: str | None = None) -> None:
        self.emit("progress", step=step, total=total, progress=progress, message=message)

    def metrics(self, **values: float) -> None:
        self.emit("metrics", **values)

    def log(self, level: str = "info", message: str = "") -> None:
        self.emit("log", level=level, message=message)

    def heartbeat(self) -> None:
        import time
        self.emit("heartbeat", at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))

    def checkpoint(self, path: str) -> None:
        self.emit("checkpoint", path=path)

    def artifact(self, path: str) -> None:
        self.emit("artifact", path=path)

    def error(self, message: str) -> None:
        self.emit("error", message=message)

    def done(self, exit_code: int = 0) -> None:
        self.emit("done", exitCode=exit_code)
