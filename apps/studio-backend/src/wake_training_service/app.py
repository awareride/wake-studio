"""FastAPI app - job-manager API (docs/modules/training.md 3, ADR-036)."""

from __future__ import annotations

import asyncio
import json
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, AsyncIterator

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field

from .auth import Auth
from .gpu import gpu_info
from .manager import JobError, JobManager
from .models import Job
from .store import Store


class JobCreate(BaseModel):
    moduleId: str
    id: str | None = None
    params: dict[str, str] = Field(default_factory=dict)
    #: job-scoped env vars (e.g. cloud keys for dataset push jobs, Q-DS-3).
    #: Passed to the subprocess env ONLY, never persisted in the job record.
    secrets: dict[str, str] = Field(default_factory=dict)


def create_app(manager: JobManager, auth: Auth, instance: str = "long-term") -> FastAPI:
    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        started_by_us = await manager.start()
        yield
        if started_by_us:
            await manager.stop()

    app = FastAPI(title="WakeStudio Training Service", version="0.1.0",
                  lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],  # we own the tunnel + PWA; CORS is not the auth boundary
        allow_methods=["*"],
        allow_headers=["*"],
    )

    def job_or_404(job_id: str) -> Job:
        job = manager.store.get_job(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail=f"no such job '{job_id}'")
        return job

    def handle(exc: Exception) -> HTTPException:
        if isinstance(exc, JobError):
            return HTTPException(status_code=400, detail=str(exc))
        return HTTPException(status_code=500, detail=str(exc))

    # --- read endpoints -----------------------------------------------------
    @app.get("/health")
    def health() -> dict[str, Any]:
        jobs = manager.store.list_jobs()
        counts: dict[str, int] = {}
        for j in jobs:
            counts[j.status.value] = counts.get(j.status.value, 0) + 1
        return {
            "status": "ok",
            "service": "studio-backend",
            "instance": instance,  # long-term | short-term (Colab runtime)
            "modules": len(manager.registry.modules()),
            "gpu": gpu_info(),
            "concurrency": manager.concurrency,
            "authEnabled": auth.enabled,
            "jobs": counts,
        }

    @app.get("/modules")
    def modules() -> dict[str, Any]:
        return {"modules": manager.registry.modules()}

    @app.get("/jobs")
    def list_jobs(limit: int = Query(default=200, le=1000)) -> dict[str, Any]:
        return {"jobs": [j.to_api() for j in manager.store.list_jobs(limit)]}

    @app.get("/jobs/{job_id}")
    def get_job(job_id: str) -> dict[str, Any]:
        return job_or_404(job_id).to_api()

    @app.get("/jobs/{job_id}/logs")
    def get_logs(job_id: str) -> dict[str, Any]:
        job = job_or_404(job_id)
        return {"jobId": job.id, "lines": job.log}

    @app.get("/artifacts/{job_id}/{name}")
    def get_artifact(job_id: str, name: str) -> FileResponse:
        artifact = manager.store.get_artifact(job_id, name)
        if artifact is None:
            raise HTTPException(status_code=404, detail=f"no artifact '{name}' for job '{job_id}'")
        path = Path(artifact["stored_path"])
        if not path.is_file():
            raise HTTPException(status_code=404, detail="artifact file missing")
        return FileResponse(
            path,
            media_type="application/octet-stream",
            filename=name,
            headers={
                "ETag": f'"{artifact["sha256"]}"',
                "X-Checksum-Sha256": artifact["sha256"],
            },
        )

    # --- job lifecycle (mutating: auth-gated, ADR-036 5) --------------------
    @app.post("/jobs", dependencies=[Depends(auth.require())])
    def create_job(body: JobCreate) -> dict[str, Any]:
        job_id = body.id or str(uuid.uuid4())
        if manager.store.get_job(job_id) is not None:
            raise HTTPException(status_code=409, detail=f"job '{job_id}' already exists")
        job = Job(id=job_id, module_id=body.moduleId, params=body.params)
        try:
            manager.create_job(job, secrets=body.secrets or None)
        except Exception as exc:  # noqa: BLE001
            raise handle(exc)
        return job.to_api()

    @app.post("/jobs/{job_id}/start", dependencies=[Depends(auth.require())])
    def start_job(job_id: str) -> dict[str, Any]:
        job = job_or_404(job_id)
        try:
            manager.start_job(job.id)
        except Exception as exc:  # noqa: BLE001
            raise handle(exc)
        return job_or_404(job_id).to_api()

    @app.post("/jobs/{job_id}/pause", dependencies=[Depends(auth.require())])
    def pause_job(job_id: str) -> dict[str, Any]:
        job = job_or_404(job_id)
        try:
            manager.pause_job(job.id)
        except Exception as exc:  # noqa: BLE001
            raise handle(exc)
        return job_or_404(job_id).to_api()

    @app.post("/jobs/{job_id}/resume", dependencies=[Depends(auth.require())])
    def resume_job(job_id: str) -> dict[str, Any]:
        job = job_or_404(job_id)
        try:
            manager.resume_job(job.id)
        except Exception as exc:  # noqa: BLE001
            raise handle(exc)
        return job_or_404(job_id).to_api()

    @app.post("/jobs/{job_id}/cancel", dependencies=[Depends(auth.require())])
    def cancel_job(job_id: str) -> dict[str, Any]:
        job = job_or_404(job_id)
        try:
            manager.cancel_job(job.id)
        except Exception as exc:  # noqa: BLE001
            raise handle(exc)
        return job_or_404(job_id).to_api()

    @app.delete("/jobs/{job_id}", dependencies=[Depends(auth.require())])
    async def delete_job(job_id: str) -> dict[str, Any]:
        job = job_or_404(job_id)
        await manager.delete_job(job.id)
        return {"deleted": job.id}

    # --- realtime -------------------------------------------------------------
    @app.get("/stream")
    async def stream(request: Request) -> StreamingResponse:
        async def events() -> AsyncIterator[str]:
            queue: asyncio.Queue = manager.subscribe()
            try:
                # snapshot first, then live events (polling-compatible baseline)
                for job in manager.snapshot():
                    yield f"event: job\ndata: {json.dumps(job)}\n\n"
                while True:
                    if await request.is_disconnected():
                        break
                    try:
                        payload = await asyncio.wait_for(queue.get(), timeout=15.0)
                    except asyncio.TimeoutError:
                        yield ": keepalive\n\n"
                        continue
                    yield (f"event: {payload['type']}\n"
                           f"data: {json.dumps(payload['job'])}\n\n")
            finally:
                manager.unsubscribe(queue)

        return StreamingResponse(events(), media_type="text/event-stream")

    return app
