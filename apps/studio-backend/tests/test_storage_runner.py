"""wake_train_kit.storage_runner + job-scoped secrets tests (ADR-044 #204).

Covers the `dataset-storage` job entry (registry + runner) and the ADR-013
tension / Q-DS-3 rule: cloud keys are passed as job-scoped env only and never
land in the persisted job record. A fake in-memory storage backend exercises
push/pull/list/delete without any real cloud.
"""

import asyncio
import json
import os
from pathlib import Path

import pytest

from wake_train_kit.storage import StorageBackend, StorageBackendError, StorageRegistry
from wake_train_kit.storage_runner import read_creds, read_params, main as runner_main


# --- runner param/creds parsing -------------------------------------------------

def test_read_params_env_and_json():
    env = {
        "STORAGE_ACTION": "pull",
        "STORAGE_BACKEND": "backend-disk",
        "STORAGE_SRC": "datasets/a.zip",
        "STORAGE_DEST": "/tmp/out.zip",
        "STORAGE_PREFIX": "datasets/",
        "WAKE_PARAMS": json.dumps({"action": "push", "src": "ignored"}),
    }
    params = read_params(env)
    # explicit env wins over WAKE_PARAMS
    assert params["action"] == "pull"
    assert params["backend"] == "backend-disk"
    assert params["src"] == "datasets/a.zip"


def test_read_creds_only_from_env():
    env = {"STORAGE_CREDS_token": "hf_secret", "STORAGE_CREDS_ACCESS_KEY_ID": "AKIA",
           "SOME_OTHER": "x"}
    creds = read_creds(env)
    assert creds == {"token": "hf_secret", "access_key_id": "AKIA"}
    assert "SOME_OTHER" not in creds


def test_runner_unknown_backend(tmp_path, monkeypatch):
    class _Reporter:
        def __init__(self):
            self.events = []
        def emit(self, event, **fields):
            self.events.append({"event": event, **fields})

    reporter = _Reporter()
    monkeypatch.setattr("wake_train_kit.storage_runner.Reporter", lambda: reporter)
    monkeypatch.setattr(os, "environ", {"STORAGE_BACKEND": "nope", "STORAGE_ACTION": "push"})
    assert runner_main([]) == 1
    assert any(e.get("event") == "error" and "unknown storage backend" in str(e) for e in reporter.events)


def test_runner_push_requires_src(tmp_path, monkeypatch):
    class _Reporter:
        def __init__(self):
            self.events = []
        def emit(self, event, **fields):
            self.events.append({"event": event, **fields})

    reporter = _Reporter()
    monkeypatch.setattr("wake_train_kit.storage_runner.Reporter", lambda: reporter)
    monkeypatch.setattr(os, "environ", {"STORAGE_ACTION": "push", "STORAGE_BACKEND": "backend-disk"})
    assert runner_main([]) == 1


# --- registry entry + job-scoped secrets via the job manager --------------------

def test_registry_has_dataset_storage_entry():
    from wake_training_service.registry import Registry
    reg = Registry.load("registry.json")
    assert reg.has("dataset-storage")
    cmd, cwd, env = reg.resolve("dataset-storage", {"action": "push", "backend": "backend-disk",
                                                    "src": "x.zip", "dest": "datasets/a.zip"})
    assert "storage_runner.py" in cmd[-1]
    assert env["STORAGE_ACTION"] == "push"
    assert env["STORAGE_BACKEND"] == "backend-disk"


def test_job_secrets_env_only_never_persisted(store, workdir, artifacts_dir, tmp_path):
    """Cloud keys pass as subprocess env only; the persisted job has no secrets.

    Uses the 'fake' train script to echo the environment, proving the manager
    forwards secrets to the subprocess while keeping them out of SQLite.
    """
    import time

    from wake_training_service.manager import JobManager
    from wake_training_service.models import Job, JobStatus
    from wake_training_service.registry import Registry

    registry = Registry({"fake": {"cwd": str(workdir), "engine": "direct",
                                  "entry": "fake_train.py",
                                  "env": {"WAKE_ECHO_SECRET": "{env.CLOUD_TOKEN}"}}})
    mgr = JobManager(store, registry, artifacts_dir, concurrency=1)

    async def scenario():
        await mgr.start()
        try:
            job = mgr.create_job(
                Job(id="secret-job", module_id="fake", params={"steps": "1"}),
                secrets={"CLOUD_TOKEN": "sk-super-secret"},
            )
            assert job.status is JobStatus.QUEUED
            # Persisted record must NOT contain the secret (params only).
            persisted = store.get_job("secret-job")
            assert "sk-super-secret" not in json.dumps(persisted.to_row())
            assert "CLOUD_TOKEN" not in json.dumps(persisted.to_row())
            # wait for the job to finish
            deadline = time.monotonic() + 10.0
            while True:
                j = store.get_job("secret-job")
                if j is None or j.status in (JobStatus.SUCCEEDED, JobStatus.FAILED):
                    break
                if time.monotonic() > deadline:
                    raise AssertionError("job did not finish")
                await asyncio.sleep(0.05)
            return store.get_job("secret-job")
        finally:
            await mgr.stop()

    persisted = asyncio.run(scenario())
    assert persisted is not None
    assert persisted.status is JobStatus.SUCCEEDED
    assert "sk-super-secret" in "\n".join(persisted.log)  # subprocess saw the env


def test_fake_storage_via_runner_end_to_end(tmp_path, monkeypatch):
    """A fake backend registered into a registry runs push/pull through the runner."""

    class Fake(StorageBackend):
        id = "fake-store"
        kind = "fake"
        authKey = None
        capabilities = frozenset({"push", "pull", "list", "delete"})
        data: dict[str, bytes] = {}

        def _push(self, src, dest, creds):
            Fake.data[dest] = Path(src).read_bytes()
            return dest

        def _pull(self, src, dest, creds):
            Path(dest).parent.mkdir(parents=True, exist_ok=True)
            Path(dest).write_bytes(Fake.data[src])
            return str(dest)

        def _list(self, prefix, creds):
            return sorted(k for k in Fake.data if k.startswith(prefix))

        def _delete(self, ref, creds):
            Fake.data.pop(ref, None)

    import wake_train_kit.storage_runner as sr
    registry = StorageRegistry()
    registry.register(Fake)
    monkeypatch.setattr(sr, "STORAGE_REGISTRY", registry)

    src = tmp_path / "ds.zip"
    src.write_bytes(b"zip")

    class _Reporter:
        def __init__(self):
            self.events = []
        def emit(self, event, **fields):
            self.events.append({"event": event, **fields})

    reporter = _Reporter()
    monkeypatch.setattr(sr, "Reporter", lambda: reporter)
    monkeypatch.setattr(os, "environ", {
        "STORAGE_ACTION": "push", "STORAGE_BACKEND": "fake-store",
        "STORAGE_SRC": str(src), "STORAGE_DEST": "datasets/ds-1.zip",
        "STORAGE_CREDS_TOKEN": "job-scoped-only",
    })
    assert runner_main([]) == 0
    done = [e for e in reporter.events if e["event"] == "done"]
    assert done and done[0]["ref"] == "datasets/ds-1.zip"
    assert Fake.data["datasets/ds-1.zip"] == b"zip"
    assert not any("TOKEN" in str(e) for e in reporter.events)
