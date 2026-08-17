"""ModuleStager + staged-job tests (#159): generic runtimes (Colab) stage
registered-module assets from the repo tarball on demand; the notebook stays
generic and the service supports every registered module.
"""

import asyncio
import shutil
import tarfile
import time
from pathlib import Path

import httpx
import pytest

from wake_training_service.app import create_app
from wake_training_service.auth import Auth
from wake_training_service.models import JobStatus
from wake_training_service.registry import Registry
from wake_training_service.staging import ModuleStager

from conftest import FAKE_SCRIPT, make_manager

FAKE_TRAIN = "packages/modules/fake/train"


def _make_repo_tarball(root: Path, archive: Path) -> Path:
    """A fake repo tarball: wake-studio-main/<module path>/fake_train.py."""
    target = root / "wake-studio-main" / FAKE_TRAIN
    target.mkdir(parents=True)
    shutil.copy(FAKE_SCRIPT, target / "fake_train.py")
    with tarfile.open(archive, "w:gz") as tf:
        tf.add(root / "wake-studio-main", arcname="wake-studio-main")
    return archive


def _staged_entry(staged_root: Path, fetch):
    return {
        "fake": {
            "cwd": "../../packages/modules/fake/train",
            "engine": "direct",
            "entry": "fake_train.py",
            "stage": {
                "paths": [FAKE_TRAIN],
                "cwd": FAKE_TRAIN,
                "env": {"FAKE_UPSTREAM": "third_party/fake"},
            },
        }
    }, staged_root


def _make_fetch(tarball: Path):
    calls = {"n": 0}

    def fetch(url, dest):
        calls["n"] += 1
        shutil.copy(tarball, dest)

    return fetch, calls


def test_stager_without_stage_spec_returns_none(tmp_path):
    stager = ModuleStager(staged_root=tmp_path / "staged")
    assert stager.prepare({"cwd": ".", "entry": "x.py"}, tmp_path) is None


def test_stager_prepare_extracts_and_resolves(tmp_path):
    archive = _make_repo_tarball(tmp_path / "src", tmp_path / "repo.tar.gz")
    fetch, calls = _make_fetch(archive)
    stager = ModuleStager(staged_root=tmp_path / "staged", fetch=fetch)
    entry, _ = _staged_entry(tmp_path / "staged", fetch)

    cwd, env = stager.prepare(entry["fake"], tmp_path)
    assert (cwd / "fake_train.py").is_file()
    assert env["FAKE_UPSTREAM"] == str((tmp_path / "staged" / "third_party" / "fake").resolve())
    assert calls["n"] == 1


def test_stager_is_idempotent_no_second_fetch(tmp_path):
    archive = _make_repo_tarball(tmp_path / "src", tmp_path / "repo.tar.gz")
    fetch, calls = _make_fetch(archive)
    stager = ModuleStager(staged_root=tmp_path / "staged", fetch=fetch)
    entry, _ = _staged_entry(tmp_path / "staged", fetch)

    stager.prepare(entry["fake"], tmp_path)
    stager.prepare(entry["fake"], tmp_path)
    assert calls["n"] == 1  # staged tree reused


def test_staged_job_runs_from_the_staged_cwd(tmp_path):
    """A job for a staged module succeeds without any local repo checkout."""

    async def scenario():
        archive = _make_repo_tarball(tmp_path / "src", tmp_path / "repo.tar.gz")
        fetch, _ = _make_fetch(archive)
        staged_root = tmp_path / "staged"
        entries, _ = _staged_entry(staged_root, fetch)
        stager = ModuleStager(staged_root=staged_root, fetch=fetch)
        registry = Registry(entries, base_dir=tmp_path)  # cwd does NOT exist here
        store = tmp_path / "db"
        from wake_training_service.store import Store

        s = Store(store / "wake-service.db")
        mgr = make_manager(s, registry, tmp_path / "artifacts", stager=stager)
        await mgr.start()
        app = create_app(mgr, Auth())

        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            r = await client.post(
                "/jobs", json={"moduleId": "fake", "id": "sj1", "params": {"steps": "2"}}
            )
            assert r.status_code == 200
            deadline = time.monotonic() + 20
            while True:
                job = s.get_job("sj1")
                assert job is not None
                if job.status in (JobStatus.SUCCEEDED, JobStatus.FAILED):
                    break
                assert time.monotonic() < deadline, f"timeout: {job.status}"
                await asyncio.sleep(0.1)
            assert s.get_job("sj1").status is JobStatus.SUCCEEDED
            assert (staged_root / FAKE_TRAIN / "fake_train.py").is_file()

    asyncio.run(scenario())
