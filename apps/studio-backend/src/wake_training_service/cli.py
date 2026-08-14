"""CLI - `uv run wake-service` (ADR-036)."""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from .app import create_app
from .auth import Auth
from .manager import JobManager
from .registry import Registry
from .store import Store

DEFAULT_PORT = 4824
DEFAULT_HOST = "127.0.0.1"


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="wake-service",
        description="WakeStudio self-hosted training service (ADR-036). "
                    "Job-manager API for module train scripts; run it locally or "
                    "inside a Colab session behind a Cloudflare tunnel (launcher glue).",
    )
    p.add_argument("--host", default=os.environ.get("WAKE_SERVICE_HOST", DEFAULT_HOST))
    p.add_argument("--port", type=int, default=int(os.environ.get("WAKE_SERVICE_PORT", DEFAULT_PORT)))
    p.add_argument("--concurrency", type=int, default=1,
                   help="max simultaneously running jobs (default 1 = one GPU)")
    p.add_argument("--token", default=os.environ.get("WAKE_SERVICE_TOKEN", ""),
                   help="token required on mutating endpoints (Colab launcher MUST set it)")
    p.add_argument("--heartbeat-timeout", type=float, default=300.0,
                   help="seconds without a report line before a job is marked failed")
    p.add_argument("--db", default="data/wake-service.db", help="SQLite job store path")
    p.add_argument("--artifacts-dir", default="data/artifacts",
                   help="where trained artifacts are stored (sha256-indexed)")
    p.add_argument("--max-artifacts-mb", type=int, default=0,
                   help="prune oldest artifacts above this total size (0 = unlimited)")
    p.add_argument("--registry", default=None,
                   help="module registry JSON (default: registry.json next to this app)")
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    app_dir = Path(__file__).resolve().parent.parent.parent
    registry_path = args.registry
    if not registry_path:
        for name in ("registry.json", "registry.example.json"):
            cand = app_dir / name
            if cand.is_file():
                registry_path = cand
                break
    if not registry_path or not Path(registry_path).is_file():
        print(f"[wake-service] registry not found: {registry_path}", file=sys.stderr)
        print("[wake-service] create one (see README.md §Registry) or pass --registry", file=sys.stderr)
        return 2

    registry = Registry.load(registry_path, base_dir=Path.cwd())
    store = Store(args.db)
    auth = Auth(args.token or None)
    manager = JobManager(
        store=store,
        registry=registry,
        artifacts_dir=args.artifacts_dir,
        concurrency=args.concurrency,
        heartbeat_timeout=args.heartbeat_timeout,
        max_artifacts_mb=args.max_artifacts_mb,
    )
    app = create_app(manager, auth)

    print(f"[wake-service] studio-backend on http://{args.host}:{args.port}")
    print(f"[wake-service] registry: {registry_path} ({len(registry.modules())} module(s))")
    print(f"[wake-service] concurrency: {args.concurrency} · heartbeat: {args.heartbeat_timeout:.0f}s")
    if auth.enabled:
        print("[wake-service] auth: token REQUIRED on mutating endpoints")
    else:
        print("[wake-service] WARNING: no token set - mutating endpoints are OPEN "
              "(set --token / WAKE_SERVICE_TOKEN)")

    import uvicorn
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
