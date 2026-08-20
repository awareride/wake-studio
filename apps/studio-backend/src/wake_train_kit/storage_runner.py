"""wake_train_kit.storage_runner — dataset-storage job entry (ADR-044 §5.3, #204).

Registry entry (engine "direct") for the studio-backend job manager (ADR-036).
Reads job params from STORAGE_* env vars + WAKE_PARAMS JSON (the registry
convention), loads the requested StorageBackend from the registry, and performs
a push / pull / list / delete. Emits the NDJSON reporting protocol on stdout:
``log``, ``done`` (with the result ref) or ``error``.

Cloud-key handling (Q-DS-3 / ADR-013 tension): the backend job receives cloud
credentials ONLY as job-scoped env vars (STORAGE_CREDS_*), never as persisted
job params — the manager keeps them out of SQLite (see wake_training_service
manager.create_job(env=...)). This module never reads or logs credential values.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any

from wake_train_kit.storage import STORAGE_REGISTRY, StorageBackendError

try:
    from wake_train_kit.report import Reporter
except ImportError:  # standalone fallback: plain NDJSON prints
    class Reporter:  # type: ignore[no-redef]
        def emit(self, event: str, **fields: Any) -> None:
            print(json.dumps({"event": event, **fields}), flush=True)


DEFAULTS: dict[str, Any] = {
    "action": "push",          # push | pull | list | delete
    "backend": "backend-disk",
    "src": "",                 # local file (push) or remote ref (pull/delete)
    "dest": "",                # remote ref (push) or local file (pull)
    "prefix": "",              # list prefix
}

ENV_MAP: dict[str, str] = {
    "STORAGE_ACTION": "action",
    "STORAGE_BACKEND": "backend",
    "STORAGE_SRC": "src",
    "STORAGE_DEST": "dest",
    "STORAGE_PREFIX": "prefix",
}

CREDS_PREFIX = "STORAGE_CREDS_"


def read_params(env: dict[str, str] | None = None) -> dict[str, Any]:
    """Job params from STORAGE_* env vars + WAKE_PARAMS JSON (both conventions)."""
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


def read_creds(env: dict[str, str] | None = None) -> dict[str, str]:
    """Job-scoped cloud credentials from STORAGE_CREDS_* env vars only.

    Never read from persisted params, never logged. e.g.
    ``STORAGE_CREDS_token`` -> {"token": "..."} for a huggingface backend.
    """
    env = env if env is not None else os.environ
    creds: dict[str, str] = {}
    for key, value in env.items():
        if key.startswith(CREDS_PREFIX):
            creds[key[len(CREDS_PREFIX):].lower()] = value
    return creds


def main(argv: list[str] | None = None) -> int:
    reporter = Reporter()
    params = read_params()
    creds = read_creds()

    action = params["action"]
    backend_id = params["backend"]
    reporter.emit(
        "log", level="info",
        message=f"dataset-storage: action={action} backend={backend_id}",
    )

    try:
        backend = STORAGE_REGISTRY.get(backend_id)
        backend.check()
        if action == "push":
            if not params["src"]:
                raise StorageBackendError("push requires a local 'src' file")
            ref = backend.push(params["src"], params["dest"], creds)
            reporter.emit("done", exitCode=0, ref=ref)
        elif action == "pull":
            if not params["src"] or not params["dest"]:
                raise StorageBackendError("pull requires 'src' (remote) and 'dest' (local)")
            dest = backend.pull(params["src"], params["dest"], creds)
            reporter.emit("done", exitCode=0, ref=str(dest))
        elif action == "list":
            refs = backend.list(params["prefix"], creds)
            reporter.emit("done", exitCode=0, refs=refs)
        elif action == "delete":
            if not params["src"]:
                raise StorageBackendError("delete requires a 'src' ref")
            backend.delete(params["src"], creds)
            reporter.emit("done", exitCode=0)
        else:
            raise StorageBackendError(
                f"unknown storage action '{action}' (push|pull|list|delete)"
            )
    except Exception as exc:  # noqa: BLE001
        reporter.emit("error", message=f"dataset-storage failed: {exc}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
