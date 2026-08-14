"""Colab launcher (issue #123, ADR-023 amendment).

Starts the studio-backend training-service inside a Colab runtime and exposes
it through a free trycloudflare tunnel, so the WakeStudio PWA drives Colab
exactly like the self-hosted backend — one HTTP client, N backends. cloudflared
is launcher glue only: it never appears inside the service itself (ADR-036 §1).

Typical notebook cell use (after `pip install git+https://github.com/awareride/
wake-studio@main#subdirectory=apps/studio-backend`):

    import os, secrets
    from wake_training_service.colab_launcher import launch
    launcher = launch(
        registry={
            "kws-openwakeword": {
                "cwd": "/content/openwakeword",
                "engine": "uv",
                "entry": "train.py",
            },
        },
        token=os.environ.get("WAKE_SERVICE_TOKEN") or secrets.token_urlsafe(24),
    )
    url = launcher.wait_for_url(timeout=120)
    print(f"Paste this URL into WakeStudio -> Training -> Connect: {url}")

`launch()` is non-blocking: the service runs in a background thread (uvicorn)
and cloudflared in a subprocess. The tunnel is monitored — if the connection
drops or cloudflared exits (Colab idle kill), it is restarted and a **fresh
URL is printed** (ADR-023 amendment, checkpoint/resume mitigation).
"""

from __future__ import annotations

import argparse
import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import threading
import time
import urllib.request
from pathlib import Path
from typing import Any, Callable, TextIO

TUNNEL_URL_RE = re.compile(r"https://[a-z0-9-]+\.trycloudflare\.com")
MAX_TUNNEL_RESTARTS = 5
RESTART_DELAY_SECONDS = 5.0
#: a subprocess-like object for the tunnel process (injectable for tests)
TunnelProc = Any


def parse_tunnel_url(line: str) -> str | None:
    """Extract the trycloudflare URL from one cloudflared output line."""
    m = TUNNEL_URL_RE.search(line)
    return m.group(0) if m else None


def find_or_install_cloudflared(print_fn: Callable[[str], None] = print) -> str:
    """Locate the cloudflared binary; pip-install it if missing (no root)."""
    found = shutil.which("cloudflared")
    if found:
        return found
    print_fn("[wake-colab] cloudflared not found — installing via pip …")
    subprocess.run(
        [sys.executable, "-m", "pip", "install", "-q", "cloudflared"],
        check=False,
    )
    found = shutil.which("cloudflared")
    if not found:
        raise RuntimeError(
            "cloudflared is not available and pip install failed. "
            "Install it manually (https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)."
        )
    return found


class ColabLauncher:
    """Start the training-service + cloudflared tunnel and monitor it."""

    def __init__(
        self,
        registry: dict[str, Any],
        port: int = 4824,
        token: str | None = None,
        db: str | Path | None = None,
        artifacts_dir: str | Path | None = None,
        heartbeat_timeout: float = 300.0,
        instance: str = "short-term",  # Colab runtime = ephemeral by nature
        cloudflared: str | None = None,
        restart_delay: float = RESTART_DELAY_SECONDS,
        print_fn: Callable[[str], None] = print,
        process_factory: Callable[[], TunnelProc] | None = None,
    ) -> None:
        from .app import create_app
        from .auth import Auth
        from .manager import JobManager
        from .registry import Registry
        from .store import Store

        self.registry_entries = registry
        self.port = int(port)
        self.token = token or secrets.token_urlsafe(24)
        self._print = print_fn

        workdir = Path.cwd()
        self._store = Store(db or (workdir / "data" / "wake-service.db"))
        self._registry = Registry(registry, base_dir=workdir)
        self._auth = Auth(self.token)
        self._manager = JobManager(
            store=self._store,
            registry=self._registry,
            artifacts_dir=artifacts_dir or (workdir / "data" / "artifacts"),
            heartbeat_timeout=heartbeat_timeout,
        )
        self._app = create_app(self._manager, self._auth, instance=instance)

        self._cloudflared_bin = cloudflared
        self._process_factory = process_factory
        self._restart_delay = restart_delay
        self._proc: TunnelProc | None = None
        self._server: Any = None
        self._server_thread: threading.Thread | None = None
        self._stop = threading.Event()
        self._url_event = threading.Event()
        self.urls: list[str] = []

    # --- lifecycle ---------------------------------------------------------
    def start(self) -> "ColabLauncher":
        self._print(
            f"[wake-colab] starting training-service on http://127.0.0.1:{self.port} "
            f"(modules: {', '.join(sorted(self.registry_entries)) or 'none'})"
        )
        self._print(
            f"[wake-colab] service token — paste into WakeStudio → Settings → Security → "
            f"backend secret: {self.token}"
        )
        self._start_service()
        if self._wait_healthy(timeout=30):
            self._print("[wake-colab] service is healthy ✓")
        else:
            self._print("[wake-colab] WARNING: service did not answer /health yet")
        threading.Thread(target=self._monitor, daemon=True).start()
        return self

    def _start_service(self) -> None:
        import uvicorn

        config = uvicorn.Config(
            self._app, host="127.0.0.1", port=self.port, log_level="warning"
        )
        self._server = uvicorn.Server(config)
        self._server_thread = threading.Thread(target=self._server.run, daemon=True)
        self._server_thread.start()

    def _wait_healthy(self, timeout: float = 30.0) -> bool:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline and not self._stop.is_set():
            try:
                with urllib.request.urlopen(
                    f"http://127.0.0.1:{self.port}/health", timeout=2
                ) as res:
                    if res.status == 200:
                        return True
            except Exception:
                pass
            time.sleep(0.5)
        return False

    def _spawn_cloudflared(self) -> TunnelProc:
        if self._process_factory is not None:
            return self._process_factory()
        if self._cloudflared_bin is None:
            self._cloudflared_bin = find_or_install_cloudflared(self._print)
        return subprocess.Popen(
            [self._cloudflared_bin, "tunnel", "--url", f"http://127.0.0.1:{self.port}"],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )

    def _add_url(self, url: str) -> None:
        fresh = not self.urls
        self.urls.append(url)
        self._url_event.set()
        if fresh:
            self._print(f"\n🚀 WakeStudio tunnel URL:\n{url}\n")
        else:
            self._print(
                f"\n🔁 Tunnel reconnected — NEW WakeStudio tunnel URL (use this one):\n{url}\n"
            )

    def _monitor(self) -> None:
        restarts = 0
        while not self._stop.is_set():
            try:
                proc = self._spawn_cloudflared()
            except Exception as exc:  # noqa: BLE001
                self._print(f"[wake-colab] failed to start cloudflared: {exc}")
                return
            self._proc = proc
            self._print(f"[wake-colab] cloudflared started (pid {proc.pid})")
            while not self._stop.is_set():
                line = proc.stdout.readline()
                if not line:
                    break
                line = line.strip()
                if line:
                    self._print(f"[cloudflared] {line}")
                url = parse_tunnel_url(line)
                if url:
                    self._add_url(url)
            if self._stop.is_set():
                break
            restarts += 1
            if restarts > MAX_TUNNEL_RESTARTS:
                self._print(
                    f"[wake-colab] tunnel process exited repeatedly; "
                    f"giving up after {restarts} restarts"
                )
                return
            self._print(
                f"[wake-colab] tunnel connection dropped — restarting "
                f"({restarts}/{MAX_TUNNEL_RESTARTS})…"
            )
            time.sleep(self._restart_delay)

    # --- public ------------------------------------------------------------
    def wait_for_url(self, timeout: float = 120.0) -> str | None:
        """Block until a tunnel URL appears (or timeout); None on timeout."""
        self._url_event.wait(timeout=timeout)
        return self.urls[-1] if self.urls else None

    def stop(self) -> None:
        self._stop.set()
        if self._proc is not None and hasattr(self._proc, "terminate"):
            try:
                self._proc.terminate()
            except Exception:  # noqa: BLE001
                pass
        if self._server is not None:
            self._server.should_exit = True
            if self._server_thread and self._server_thread.is_alive():
                self._server_thread.join(timeout=8)
        # close any cloudflared child (monitor restarts are gated by _stop)
        self._store.close()


def launch(**kwargs: Any) -> ColabLauncher:
    """Create + start a launcher (see ColabLauncher)."""
    launcher = ColabLauncher(**kwargs)
    return launcher.start()


# --- CLI: `python -m wake_training_service.colab_launcher` -------------------
def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="wake-colab",
        description="Start the studio-backend training-service + a trycloudflare tunnel "
                    "(Colab launcher, issue #123).",
    )
    p.add_argument("--port", type=int, default=int(os.environ.get("WAKE_SERVICE_PORT", "4824")))
    p.add_argument("--token", default=os.environ.get("WAKE_SERVICE_TOKEN", ""),
                   help="token for mutating endpoints (generated + printed if empty)")
    p.add_argument("--registry", default=None, help="path to a registry JSON")
    p.add_argument("--module", default=None, help="build a one-module registry: module id")
    p.add_argument("--cwd", default=None, help="build a one-module registry: train working dir")
    p.add_argument("--entry", default=None, help="build a one-module registry: train entry path")
    p.add_argument("--engine", default="uv", help="build a one-module registry: uv|direct")
    p.add_argument("--db", default=None)
    p.add_argument("--artifacts-dir", default=None)
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    registry: dict[str, Any]
    if args.registry:
        registry = json.loads(Path(args.registry).read_text())
    elif args.module and args.cwd and args.entry:
        registry = {
            args.module: {"cwd": args.cwd, "engine": args.engine, "entry": args.entry}
        }
    else:
        print("[wake-colab] need --registry or --module/--cwd/--entry", file=sys.stderr)
        return 2

    launcher = launch(
        registry=registry,
        port=args.port,
        token=args.token or None,
        db=args.db,
        artifacts_dir=args.artifacts_dir,
    )
    try:
        launcher.wait_for_url(timeout=180)
        print("[wake-colab] running — Ctrl-C to stop")
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        pass
    finally:
        launcher.stop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
