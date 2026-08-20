"""Job manager - queue, subprocess supervisor, NDJSON parsing (ADR-036).

Each training job = one child OS process (`uv run <script>` per ADR-028, or
`direct` for dev/tests). The stdout pipe is the IPC channel: report lines are
NDJSON (docs/modules/training.md 4.4); everything else lands in the job log.

State machine:
    new -> queued -> running <-> paused -> succeeded | failed | canceled
Single-concurrency by default (one GPU); --concurrency N overrides. SQLite
persists queue + state so a Colab runtime restart does not lose jobs.
"""

from __future__ import annotations

import asyncio
import hashlib
import shutil
import signal
import time
from pathlib import Path
from typing import Any

from .models import CAN_CANCEL, CAN_PAUSE, CAN_START, Job, JobStatus, now_ms
from .ndjson import parse_report_line
from .registry import Registry, RegistryError
from .staging import ModuleStager
from .store import Store
from wake_train_kit.dataset_store import DatasetStore

TERM_GRACE_SECONDS = 5.0


class JobError(ValueError):
    pass


class JobManager:
    def __init__(
        self,
        store: Store,
        registry: Registry,
        artifacts_dir: str | Path,
        concurrency: int = 1,
        heartbeat_timeout: float = 300.0,
        max_artifacts_mb: int = 0,
        staged_dir: str | Path | None = None,
        stager: ModuleStager | None = None,
        datasets_dir: str | Path | None = None,
    ) -> None:
        self.store = store
        self.registry = registry
        self.artifacts_dir = Path(artifacts_dir)
        self.artifacts_dir.mkdir(parents=True, exist_ok=True)
        self.concurrency = max(1, concurrency)
        self.heartbeat_timeout = heartbeat_timeout
        self.max_artifacts_mb = max_artifacts_mb
        #: durable datasets/ store (ADR-044, #204): generated dataset zips are
        #: persisted here across restarts, mirroring the artifacts store. None
        #: when the service is started without a datasets dir.
        self.datasets_dir = Path(datasets_dir) if datasets_dir else None
        self.dataset_store = (
            DatasetStore(self.datasets_dir) if self.datasets_dir is not None else None
        )
        #: generic-runtime module staging (Colab: no repo checkout); None when
        #: the service runs against a local repo checkout (self-hosted)
        self._stager = stager or (
            ModuleStager(staged_root=staged_dir) if staged_dir else None
        )

        self.queue: asyncio.Queue[str] = asyncio.Queue()
        self._enqueued: set[str] = set()
        self._tasks: dict[str, asyncio.Task] = {}
        self._workers: list[asyncio.Task] = []
        self._pending: dict[str, str] = {}       # job_id -> "pause" | "cancel"
        self._last_activity: dict[str, float] = {}
        self._cwd: dict[str, str] = {}
        self._subscribers: list[asyncio.Queue] = []
        self._stopping = False
        self._started = False
        #: job-scoped secrets (cloud keys, Q-DS-3): passed to the subprocess
        #: env ONLY, held in memory, never persisted (ADR-013 tension).
        self._job_secrets: dict[str, dict[str, str]] = {}

    # --- lifecycle ----------------------------------------------------------
    async def start(self) -> bool:
        """Rebuild the queue from persisted state and spawn workers.

        Returns True if THIS call started the manager (idempotent: the app
        lifespan and tests both call it; the one that started it owns stop()).
        """
        if self._started:
            return False
        self._started = True
        for job in self.store.list_jobs():
            if job.status is JobStatus.QUEUED:
                self._enqueue_id(job.id)
            elif job.status is JobStatus.RUNNING:
                # a previous process died; hold at a resume point
                job.set_status(JobStatus.PAUSED,
                               error="interrupted by service restart (resume available)")
                self.store.update_job(job)
            elif job.status is JobStatus.PAUSED:
                pass  # stays paused; resume() re-enqueues
        for _ in range(self.concurrency):
            self._workers.append(asyncio.create_task(self._worker()))
        return True

    async def stop(self) -> None:
        if not self._started:
            return
        self._started = False
        self._stopping = True
        for task in self._workers:
            task.cancel()
        await asyncio.gather(*self._workers, return_exceptions=True)
        # hold running jobs at a resume point for the next start
        for job_id, task in list(self._tasks.items()):
            if not task.done():
                task.cancel()
        for job in self.store.jobs_by_status(JobStatus.RUNNING):
            job.set_status(JobStatus.PAUSED,
                           error="service stopped (resume available)")
            self.store.update_job(job)

    # --- public API (called by FastAPI routes) -----------------------------
    def create_job(self, job: Job, secrets: dict[str, str] | None = None) -> Job:
        if not self.registry.has(job.module_id):
            raise JobError(f"unknown module '{job.module_id}' (not in registry)")
        job.status = JobStatus.QUEUED
        job.touch()
        self.store.create_job(job)
        if secrets:
            # job-scoped env only: held in memory, NEVER persisted (Q-DS-3).
            self._job_secrets[job.id] = dict(secrets)
        self._enqueue_id(job.id)
        self._publish(job)
        return job

    def start_job(self, job_id: str) -> Job:
        job = self._require(job_id)
        if job.status not in CAN_START:
            raise JobError(f"cannot start job in state '{job.status.value}'")
        if job.status is JobStatus.PAUSED:
            job.set_status(JobStatus.QUEUED)
            self.store.update_job(job)
        self._enqueue_id(job.id)
        self._publish(job)
        return job

    def pause_job(self, job_id: str) -> Job:
        job = self._require(job_id)
        if job.status not in CAN_PAUSE:
            raise JobError(f"cannot pause job in state '{job.status.value}'")
        self._pending[job_id] = "pause"
        return job

    def resume_job(self, job_id: str) -> Job:
        return self.start_job(job_id)

    def cancel_job(self, job_id: str) -> Job:
        job = self._require(job_id)
        if job.status not in CAN_CANCEL:
            raise JobError(f"cannot cancel job in state '{job.status.value}'")
        if job.status is JobStatus.RUNNING:
            self._pending[job_id] = "cancel"
        else:
            job.set_status(JobStatus.CANCELED)
            self.store.update_job(job)
            self._publish(job)
        return job

    async def delete_job(self, job_id: str) -> None:
        task = self._tasks.get(job_id)
        if task and not task.done():
            self._pending[job_id] = "cancel"
            try:
                await asyncio.wait_for(task, timeout=TERM_GRACE_SECONDS + 5)
            except asyncio.TimeoutError:
                pass
        for artifact in self.store.list_artifacts(job_id):
            try:
                Path(artifact["stored_path"]).unlink(missing_ok=True)
            except OSError:
                pass
        shutil.rmtree(self.artifacts_dir / job_id, ignore_errors=True)
        if self.dataset_store is not None:
            # drop the stored dataset copy too (mirrors artifact cleanup)
            for record in self.dataset_store.list():
                stored = Path(record["stored_path"])
                if job_id in stored.parts:
                    self.dataset_store.delete(record["id"])
        self.store.delete_job(job_id)
        self._pending.pop(job_id, None)
        self._tasks.pop(job_id, None)
        self._last_activity.pop(job_id, None)
        self._cwd.pop(job_id, None)
        self._job_secrets.pop(job_id, None)

    # --- worker -------------------------------------------------------------
    def _enqueue_id(self, job_id: str) -> None:
        if job_id not in self._enqueued:
            self._enqueued.add(job_id)
            self.queue.put_nowait(job_id)

    async def _worker(self) -> None:
        while not self._stopping:
            job_id = await self.queue.get()
            self._enqueued.discard(job_id)
            try:
                await self._run_job(job_id)
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # never kill the worker
                job = self.store.get_job(job_id)
                if job and job.status is JobStatus.RUNNING:
                    job.set_status(JobStatus.FAILED, error=f"runner error: {exc}")
                    self.store.update_job(job)
                    self._publish(job)
            finally:
                self.queue.task_done()

    async def _run_job(self, job_id: str) -> None:
        job = self.store.get_job(job_id)
        if job is None or job.status is not JobStatus.QUEUED:
            return  # canceled/paused while queued

        job.set_status(JobStatus.RUNNING)
        self.store.update_job(job)
        self._publish(job)
        self._pending.pop(job_id, None)

        try:
            staged = None
            if self._stager:
                staged = self._stager.prepare(
                    self.registry.entry(job.module_id), self.registry.base_dir
                )
            cmd, cwd, env = self.registry.resolve(
                job.module_id, job.params, staged=staged,
                secrets=self._job_secrets.get(job.id),
            )
        except RegistryError as exc:
            job.set_status(JobStatus.FAILED, error=str(exc))
            self.store.update_job(job)
            self._publish(job)
            return

        self._cwd[job_id] = cwd
        if job.checkpoint:
            env["WAKE_RESUME"] = "1"
            env["WAKE_CHECKPOINT"] = job.checkpoint

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            cwd=cwd,
            env=env,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        job.pid = proc.pid
        self.store.update_job(job)
        self._tasks[job_id] = asyncio.current_task()
        self._last_activity[job_id] = time.monotonic()

        check_interval = min(max(0.2, self.heartbeat_timeout / 4), 2.0)
        exit_code: int | None = None
        acted: str | None = None  # "pause"/"cancel" only when we actually acted
        try:
            while True:
                try:
                    raw = await asyncio.wait_for(proc.stdout.readline(),
                                                 timeout=check_interval)
                except asyncio.TimeoutError:
                    raw = None
                    pending = self._pending.get(job_id)
                    if pending == "pause":
                        acted = "pause"
                        await self._terminate(proc)
                        break
                    if pending == "cancel":
                        acted = "cancel"
                        await self._terminate(proc)
                        break
                    if self._is_stale(job_id):
                        await self._kill(proc)
                        job.error = (
                            f"job stalled: no heartbeat for "
                            f"{self.heartbeat_timeout:.0f}s"
                        )
                        break
                    continue
                if raw:  # a line
                    self._last_activity[job_id] = time.monotonic()
                    line = raw.decode("utf-8", errors="replace").rstrip("\n")
                    job.append_log(line)
                    report = parse_report_line(line)
                    if report:
                        self._handle_report(job, report)
                    self.store.update_job(job)
                    # service pending actions between lines too (a script that
                    # outputs continuously never hits the read timeout)
                    pending = self._pending.get(job_id)
                    if pending == "pause":
                        acted = "pause"
                        await self._terminate(proc)
                        await self._drain(proc, job)  # capture checkpoint/log lines
                        break
                    if pending == "cancel":
                        acted = "cancel"
                        await self._terminate(proc)
                        await self._drain(proc, job)  # capture partial outputs
                        break
                else:  # EOF
                    break
            exit_code = await proc.wait()
        except asyncio.CancelledError:
            await self._terminate(proc)
            exit_code = await proc.wait()
            raise
        finally:
            self._tasks.pop(job_id, None)
            self._last_activity.pop(job_id, None)

        self._pending.pop(job_id, None)
        if acted == "pause":
            job.set_status(JobStatus.PAUSED, error=None)
        elif acted == "cancel":
            job.set_status(JobStatus.CANCELED, error=None)
        elif job.error and exit_code != 0:
            job.set_status(JobStatus.FAILED)
        elif exit_code == 0:
            job.set_status(JobStatus.SUCCEEDED)
        else:
            job.set_status(JobStatus.FAILED,
                           error=job.error or f"train script exited with code {exit_code}")
        job.exit_code = exit_code
        job.pid = None
        self.store.update_job(job)
        self._publish(job)

    # --- report handling -----------------------------------------------------
    def _handle_report(self, job: Job, report: dict[str, Any]) -> None:
        event = report.get("event")
        if event == "progress":
            if report.get("progress") is not None:
                job.progress = float(report["progress"])
        elif event == "metrics":
            for k, v in report.items():
                if k in ("event",):
                    continue
                try:
                    job.metrics[k] = float(v)
                except (TypeError, ValueError):
                    pass
        elif event == "checkpoint":
            job.checkpoint = str(report.get("path") or job.checkpoint)
        elif event == "artifact":
            self._register_artifact(job, str(report.get("path", "")))
        elif event == "error":
            job.error = str(report.get("message") or job.error)
        elif event == "done":
            pass  # exit code comes from the process itself
        # log/heartbeat are handled implicitly

    def _register_artifact(self, job: Job, path: str) -> None:
        if not path:
            return
        cwd = self._cwd.get(job.id, "")
        src = Path(path)
        if not src.is_absolute():
            src = Path(cwd) / src
        if not src.is_file():
            return
        dest_dir = self.artifacts_dir / job.id
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest = dest_dir / src.name
        shutil.copy2(src, dest)
        sha = hashlib.sha256(dest.read_bytes()).hexdigest()
        size = dest.stat().st_size
        self.store.add_artifact(job.id, src.name, str(dest), sha, size)
        if src.name not in job.artifacts:
            job.artifacts.append(src.name)
        self._prune_artifacts()
        # A canonical dataset zip produced by a dataset-generate job is also a
        # FIRST-CLASS dataset: persist it into the durable datasets/ store
        # (mirrors the artifacts store; survives restarts, ADR-044 #204).
        if src.name == "wake-studio-dataset.zip" and self.dataset_store is not None:
            try:
                self.dataset_store.save(dest)
            except Exception as exc:  # noqa: BLE001 - never fail the job for a store issue
                if job.error is None:
                    job.error = f"dataset store: {exc}"

    def _prune_artifacts(self) -> None:
        if not self.max_artifacts_mb:
            return
        limit = self.max_artifacts_mb * 1024 * 1024
        files = sorted(
            (p for p in self.artifacts_dir.rglob("*") if p.is_file()),
            key=lambda p: p.stat().st_mtime,
        )
        total = sum(p.stat().st_size for p in files)
        for p in files:
            if total <= limit:
                break
            try:
                size = p.stat().st_size
                p.unlink()
                total -= size
            except OSError:
                pass

    # --- helpers ---------------------------------------------------------------
    def _require(self, job_id: str) -> Job:
        job = self.store.get_job(job_id)
        if job is None:
            raise JobError(f"no such job '{job_id}'")
        return job

    def _is_stale(self, job_id: str) -> bool:
        last = self._last_activity.get(job_id)
        return last is not None and (time.monotonic() - last) > self.heartbeat_timeout

    async def _drain(self, proc: asyncio.subprocess.Process, job: Job) -> None:
        """Read remaining stdout after SIGTERM (late checkpoint/artifact lines)."""
        while True:
            raw = await proc.stdout.readline()
            if not raw:
                return
            line = raw.decode("utf-8", errors="replace").rstrip("\n")
            job.append_log(line)
            report = parse_report_line(line)
            if report:
                self._handle_report(job, report)
            self.store.update_job(job)

    async def _terminate(self, proc: asyncio.subprocess.Process) -> None:
        """SIGTERM, then SIGKILL after grace; waits for exit."""
        if proc.returncode is not None:
            return
        try:
            proc.send_signal(signal.SIGTERM)
        except ProcessLookupError:
            return
        try:
            await asyncio.wait_for(proc.wait(), timeout=TERM_GRACE_SECONDS)
        except asyncio.TimeoutError:
            await self._kill(proc)
            await proc.wait()

    async def _kill(self, proc: asyncio.subprocess.Process) -> None:
        try:
            proc.send_signal(signal.SIGKILL)
        except ProcessLookupError:
            pass

    # --- SSE broadcast ----------------------------------------------------------
    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=100)
        self._subscribers.append(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        if q in self._subscribers:
            self._subscribers.remove(q)

    def _publish(self, job: Job) -> None:
        payload = {"type": "job", "job": job.to_api()}
        for q in list(self._subscribers):
            try:
                q.put_nowait(payload)
            except asyncio.QueueFull:
                pass  # slow subscriber; polling remains the fallback

    def snapshot(self) -> list[dict[str, Any]]:
        return [job.to_api() for job in self.store.list_jobs()]
