"""Job manager tests - lifecycle, queue, pause/resume, cancel, heartbeat,
persistence, SSE plumbing. Each test runs one asyncio loop via asyncio.run."""

import asyncio
import time

from wake_training_service.manager import JobManager
from wake_training_service.models import Job, JobStatus

from conftest import make_job, make_manager


def run(coro):
    return asyncio.run(coro)


async def wait_status(store, job_id, statuses, timeout=20.0):
    deadline = time.monotonic() + timeout
    while True:
        job = store.get_job(job_id)
        assert job is not None, f"job {job_id} missing"
        if job.status in statuses:
            return job
        if time.monotonic() > deadline:
            raise AssertionError(
                f"job {job_id} not in {[s.value for s in statuses]} "
                f"(got {job.status.value})")
        await asyncio.sleep(0.05)


def test_full_lifecycle(store, registry, artifacts_dir):
    async def scenario():
        mgr = make_manager(store, registry, artifacts_dir)
        await mgr.start()
        job = mgr.create_job(Job(id="job-1", module_id="fake",
                                 params={"steps": "3", "sleep": "0.02"}))
        assert job.status is JobStatus.QUEUED

        done = await wait_status(store, "job-1", {JobStatus.SUCCEEDED})
        assert done.progress == 1.0
        assert done.exit_code == 0
        assert done.pid is None
        assert "fake train start" in "\n".join(done.log)
        assert done.artifacts == ["model.onnx"]

        art = store.get_artifact("job-1", "model.onnx")
        assert art is not None
        assert art["size_bytes"] == len(b"fake-model-bytes")
        assert (artifacts_dir / "job-1" / "model.onnx").is_file()
        await mgr.stop()
    run(scenario())


def test_queue_single_concurrency(store, registry, artifacts_dir):
    async def scenario():
        mgr = make_manager(store, registry, artifacts_dir, concurrency=1)
        await mgr.start()
        a = mgr.create_job(Job(id="a", module_id="fake",
                               params={"steps": "60", "sleep": "0.02"}))
        assert a.id == "a"
        await wait_status(store, "a", {JobStatus.RUNNING})

        mgr.create_job(Job(id="b", module_id="fake",
                           params={"steps": "2", "sleep": "0.01"}))
        await asyncio.sleep(0.2)
        assert store.get_job("b").status is JobStatus.QUEUED  # waits for the slot

        await wait_status(store, "b", {JobStatus.SUCCEEDED}, timeout=20)
        await wait_status(store, "a", {JobStatus.SUCCEEDED}, timeout=20)
        await mgr.stop()
    run(scenario())


def test_pause_resume_checkpoint(store, registry, artifacts_dir):
    async def scenario():
        mgr = make_manager(store, registry, artifacts_dir)
        await mgr.start()
        mgr.create_job(Job(id="p", module_id="fake",
                           params={"steps": "200", "sleep": "0.01"}))
        await wait_status(store, "p", {JobStatus.RUNNING})
        for _ in range(200):  # let it make some progress first
            if (j := store.get_job("p")).progress and j.progress > 0.05:
                break
            await asyncio.sleep(0.05)

        mgr.pause_job("p")
        paused = await wait_status(store, "p", {JobStatus.PAUSED})
        assert paused.checkpoint is not None, "pause should record a checkpoint"
        await asyncio.sleep(0.2)
        assert store.get_job("p").status is JobStatus.PAUSED  # stays paused

        mgr.resume_job("p")
        done = await wait_status(store, "p", {JobStatus.SUCCEEDED}, timeout=30)
        assert done.progress == 1.0
        await mgr.stop()
    run(scenario())


def test_cancel_running_job(store, registry, artifacts_dir):
    async def scenario():
        mgr = make_manager(store, registry, artifacts_dir)
        await mgr.start()
        mgr.create_job(Job(id="c", module_id="fake",
                           params={"steps": "400", "sleep": "0.01"}))
        await wait_status(store, "c", {JobStatus.RUNNING})
        for _ in range(200):
            if (j := store.get_job("c")).progress and j.progress > 0.05:
                break
            await asyncio.sleep(0.05)

        mgr.cancel_job("c")
        canceled = await wait_status(store, "c", {JobStatus.CANCELED})
        assert canceled.finished_at_ms is not None
        await mgr.stop()
    run(scenario())


def test_heartbeat_stale_marks_failed(store, registry, artifacts_dir):
    async def scenario():
        mgr = make_manager(store, registry, artifacts_dir, heartbeat_timeout=0.5)
        await mgr.start()
        mgr.create_job(Job(id="s", module_id="fake", params={"stall": "1"}))
        failed = await wait_status(store, "s", {JobStatus.FAILED}, timeout=10)
        assert failed.error and "stalled" in failed.error
        await mgr.stop()
    run(scenario())


def test_failed_exit_code(store, registry, artifacts_dir):
    async def scenario():
        mgr = make_manager(store, registry, artifacts_dir)
        await mgr.start()
        mgr.create_job(Job(id="f", module_id="fake",
                           params={"fail": "1", "steps": "2"}))
        failed = await wait_status(store, "f", {JobStatus.FAILED})
        assert failed.exit_code == 1
        assert failed.error and "simulated" in failed.error
        await mgr.stop()
    run(scenario())


def test_paused_job_survives_restart(store, registry, artifacts_dir):
    async def scenario():
        mgr1 = make_manager(store, registry, artifacts_dir)
        await mgr1.start()
        mgr1.create_job(Job(id="r", module_id="fake",
                            params={"steps": "200", "sleep": "0.01"}))
        await wait_status(store, "r", {JobStatus.RUNNING})
        for _ in range(200):
            if (j := store.get_job("r")).progress and j.progress > 0.05:
                break
            await asyncio.sleep(0.05)
        mgr1.pause_job("r")
        await wait_status(store, "r", {JobStatus.PAUSED})
        await mgr1.stop()

        # fresh manager, same DB -> job stays paused, resume works
        mgr2 = make_manager(store, registry, artifacts_dir)
        await mgr2.start()
        assert store.get_job("r").status is JobStatus.PAUSED
        mgr2.resume_job("r")
        done = await wait_status(store, "r", {JobStatus.SUCCEEDED}, timeout=30)
        assert done.progress == 1.0
        await mgr2.stop()
    run(scenario())


def test_queued_job_survives_restart(store, registry, artifacts_dir):
    async def scenario():
        # job created directly in the store (simulates a crashed process)
        make_job(store, registry, job_id="q", params={"steps": "2"})

        mgr = make_manager(store, registry, artifacts_dir)
        await mgr.start()  # rebuilds the queue from persisted state
        done = await wait_status(store, "q", {JobStatus.SUCCEEDED})
        assert done.status is JobStatus.SUCCEEDED
        await mgr.stop()
    run(scenario())


def test_delete_removes_job_and_artifacts(store, registry, artifacts_dir):
    async def scenario():
        mgr = make_manager(store, registry, artifacts_dir)
        await mgr.start()
        mgr.create_job(Job(id="d", module_id="fake",
                           params={"steps": "2", "sleep": "0.01"}))
        await wait_status(store, "d", {JobStatus.SUCCEEDED})
        assert (artifacts_dir / "d" / "model.onnx").is_file()

        await mgr.delete_job("d")
        assert store.get_job("d") is None
        assert store.list_artifacts("d") == []
        assert not (artifacts_dir / "d").exists()
        await mgr.stop()
    run(scenario())


def test_sse_subscribe_gets_job_events(store, registry, artifacts_dir):
    async def scenario():
        mgr = make_manager(store, registry, artifacts_dir)
        await mgr.start()
        q = mgr.subscribe()
        mgr.create_job(Job(id="e", module_id="fake",
                           params={"steps": "1", "sleep": "0.01"}))
        payload = await asyncio.wait_for(q.get(), timeout=5)
        assert payload["type"] == "job"
        assert payload["job"]["id"] == "e"
        await wait_status(store, "e", {JobStatus.SUCCEEDED})
        mgr.unsubscribe(q)
        await mgr.stop()
    run(scenario())
