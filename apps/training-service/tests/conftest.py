"""Shared fixtures for training-service tests."""

from __future__ import annotations

import shutil
from pathlib import Path

import pytest

from wake_training_service.manager import JobManager
from wake_training_service.models import Job
from wake_training_service.registry import Registry
from wake_training_service.store import Store

FAKE_SCRIPT = Path(__file__).parent / "fake_train.py"


@pytest.fixture
def workdir(tmp_path):
    d = tmp_path / "train"
    d.mkdir()
    shutil.copy(FAKE_SCRIPT, d / "fake_train.py")
    return d


@pytest.fixture
def registry(workdir):
    return Registry({"fake": {"cwd": str(workdir), "engine": "direct",
                              "entry": "fake_train.py"}})


@pytest.fixture
def store(tmp_path):
    return Store(tmp_path / "wake-service.db")


@pytest.fixture
def artifacts_dir(tmp_path):
    return tmp_path / "artifacts"


def make_manager(store, registry, artifacts_dir, **kwargs):
    return JobManager(store, registry, artifacts_dir, **kwargs)


def make_job(store, registry, module_id="fake", params=None, job_id=None):
    job = Job(id=job_id or "job-1", module_id=module_id, params=params or {})
    store.create_job(job)
    return job
