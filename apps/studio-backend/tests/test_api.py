"""API tests - routes, auth gating, artifact serving, SSE (via ASGITransport)."""

import asyncio
import hashlib
import time

import httpx

from wake_training_service.app import create_app
from wake_training_service.auth import Auth
from wake_training_service.models import JobStatus

from conftest import make_manager


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


def client_for(app):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                             base_url="http://test")


def test_health_and_modules(store, registry, artifacts_dir):
    async def scenario():
        mgr = make_manager(store, registry, artifacts_dir)
        await mgr.start()
        app = create_app(mgr, Auth())
        async with client_for(app) as client:
            r = await client.get("/health")
            assert r.status_code == 200
            body = r.json()
            assert body["service"] == "studio-backend"
            assert body["instance"] == "long-term"
            assert body["modules"] == 1
            assert body["authEnabled"] is False
            assert "gpu" in body

            r = await client.get("/modules")
            assert r.json()["modules"][0]["moduleId"] == "fake"
        await mgr.stop()
    run(scenario())


def test_job_lifecycle_via_api(store, registry, artifacts_dir):
    async def scenario():
        mgr = make_manager(store, registry, artifacts_dir)
        await mgr.start()
        app = create_app(mgr, Auth())
        async with client_for(app) as client:
            # create auto-enqueues (contract: POST /jobs = create + enqueue)
            r = await client.post("/jobs", json={
                "moduleId": "fake", "id": "j1", "params": {"steps": "2"}})
            assert r.status_code == 200
            assert r.json()["status"] == "queued"
            await wait_status(store, "j1", {JobStatus.SUCCEEDED})

            r = await client.get("/jobs/j1")
            assert r.json()["status"] == "succeeded"
            assert r.json()["progress"] == 1.0
            assert r.json()["exitCode"] == 0

            r = await client.get("/jobs/j1/logs")
            assert r.status_code == 200
            assert any("fake train start" in line for line in r.json()["lines"])

            r = await client.get("/artifacts/j1/model.onnx")
            assert r.status_code == 200
            assert r.content == b"fake-model-bytes"
            assert r.headers["x-checksum-sha256"] == hashlib.sha256(
                b"fake-model-bytes").hexdigest()

            # pause -> start (resume) via API on a long job
            r = await client.post("/jobs", json={
                "moduleId": "fake", "id": "j2",
                "params": {"steps": "200", "sleep": "0.01"}})
            assert r.status_code == 200
            await wait_status(store, "j2", {JobStatus.RUNNING})
            for _ in range(200):
                if (j := store.get_job("j2")).progress and j.progress > 0.05:
                    break
                await asyncio.sleep(0.05)
            r = await client.post("/jobs/j2/pause")
            assert r.status_code == 200
            await wait_status(store, "j2", {JobStatus.PAUSED})
            r = await client.post("/jobs/j2/start")
            assert r.status_code == 200
            await wait_status(store, "j2", {JobStatus.SUCCEEDED}, timeout=30)

            # errors
            r = await client.post("/jobs", json={"moduleId": "nope"})
            assert r.status_code == 400
            r = await client.get("/jobs/zzz")
            assert r.status_code == 404
            r = await client.get("/artifacts/j1/nope.onnx")
            assert r.status_code == 404
        await mgr.stop()
    run(scenario())


def test_token_auth_gates_mutations(store, registry, artifacts_dir):
    async def scenario():
        mgr = make_manager(store, registry, artifacts_dir)
        await mgr.start()
        app = create_app(mgr, Auth(token="sekrit"))
        async with client_for(app) as client:
            assert (await client.get("/health")).status_code == 200  # reads open

            # create without token -> 401
            r = await client.post("/jobs", json={"moduleId": "fake", "id": "a1"})
            assert r.status_code == 401
            # with token -> 200
            r = await client.post("/jobs", json={"moduleId": "fake", "id": "a1"},
                                  headers={"Authorization": "Bearer sekrit"})
            assert r.status_code == 200

            # start gated regardless of job state (dependency runs first)
            r = await client.post("/jobs/a1/start")
            assert r.status_code == 401
            r = await client.post("/jobs/a1/start", headers={"X-API-Key": "nope"})
            assert r.status_code == 401
            r = await client.delete("/jobs/a1")
            assert r.status_code == 401

            # pause + start (resume) with the token
            r = await client.post("/jobs", json={
                "moduleId": "fake", "id": "a2",
                "params": {"steps": "200", "sleep": "0.01"}},
                headers={"Authorization": "Bearer sekrit"})
            assert r.status_code == 200
            await wait_status(store, "a2", {JobStatus.RUNNING})
            for _ in range(200):
                if (j := store.get_job("a2")).progress and j.progress > 0.05:
                    break
                await asyncio.sleep(0.05)
            r = await client.post("/jobs/a2/pause",
                                  headers={"Authorization": "Bearer sekrit"})
            assert r.status_code == 200
            await wait_status(store, "a2", {JobStatus.PAUSED})
            r = await client.post("/jobs/a2/start",
                                  headers={"Authorization": "Bearer sekrit"})
            assert r.status_code == 200
            await wait_status(store, "a2", {JobStatus.SUCCEEDED}, timeout=30)

            r = await client.delete("/jobs/a2", headers={"Authorization": "Bearer sekrit"})
            assert r.status_code == 200
            assert store.get_job("a2") is None
        await mgr.stop()
    run(scenario())


def test_stream_endpoint(store, registry, artifacts_dir):
    """SSE over a real uvicorn server (ASGITransport buffers whole bodies and
    would deadlock on an infinite stream)."""
    import threading

    import uvicorn

    from wake_training_service.models import Job

    async def scenario():
        mgr = make_manager(store, registry, artifacts_dir)
        await mgr.start()
        mgr.create_job(Job(id="stream1", module_id="fake",
                           params={"steps": "1", "sleep": "0.01"}))
        app = create_app(mgr, Auth())

        server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=0,
                                               log_level="error"))
        thread = threading.Thread(target=server.run, daemon=True)
        thread.start()
        for _ in range(200):
            if server.started:
                break
            await asyncio.sleep(0.05)
        assert server.started, "uvicorn did not start"
        port = server.servers[0].sockets[0].getsockname()[1]

        async with httpx.AsyncClient(base_url=f"http://127.0.0.1:{port}") as client:
            async with client.stream("GET", "/stream") as r:
                assert r.status_code == 200
                assert r.headers["content-type"].startswith("text/event-stream")
                chunks = b""
                async for chunk in r.aiter_bytes():
                    chunks += chunk
                    if b"event: job" in chunks and b"stream1" in chunks:
                        break  # snapshot event with the job arrived
                assert b"event: job" in chunks
                assert b"stream1" in chunks

        server.should_exit = True
        thread.join(timeout=5)
        await mgr.stop()
    run(scenario())
