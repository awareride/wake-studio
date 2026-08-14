"""Colab launcher tests (issue #123).

The tunnel process is faked (no network): a line source that yields the
trycloudflare banner lines cloudflared prints. One integration test starts
the real service (uvicorn thread) with a fake tunnel and checks /health.
"""

import io
import json
import socket
import threading
import time
import urllib.request

from wake_training_service.colab_launcher import (
    ColabLauncher,
    launch,
    parse_tunnel_url,
)

URL1 = "https://abc-123.trycloudflare.com"
URL2 = "https://def-456.trycloudflare.com"


class FakeTunnel:
    """subprocess-like object: yields lines, then EOF (or blocks)."""

    def __init__(self, lines: list[str], block: bool = True, pid: int = 1) -> None:
        self.pid = pid
        self._lines = list(lines)
        self._i = 0
        self._block = block
        self._released = threading.Event()

    # the monitor reads proc.stdout.readline() — expose ourselves as stdout
    @property
    def stdout(self):
        return self

    def readline(self) -> str:
        if self._i < len(self._lines):
            line = self._lines[self._i]
            self._i += 1
            return line
        if self._block:
            self._released.wait(10)
        return ""

    def terminate(self) -> None:
        self._released.set()


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def quiet(*_args, **_kwargs):
    return None


def test_parse_tunnel_url():
    # the URL is found wherever it appears on a line (banner + URL on one
    # line, or on separate lines — the monitor parses per line)
    assert parse_tunnel_url(
        "Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):\n"
        + URL1
    ) == URL1
    assert parse_tunnel_url(URL1) == URL1
    assert parse_tunnel_url(f"  {URL1}  ") == URL1
    assert parse_tunnel_url("2026-08-14T10:00:00Z INF Registered tunnel connection") is None
    assert parse_tunnel_url("") is None
    assert parse_tunnel_url("not a url https://example.com") is None


def test_monitor_detects_url_and_waits():
    launcher = ColabLauncher(
        registry={"fake": {"cwd": "/tmp", "engine": "direct", "entry": "x.py"}},
        db="/tmp/db.sqlite",
        artifacts_dir="/tmp/art",
        token="t",
        print_fn=quiet,
        process_factory=lambda: FakeTunnel([f"banner line\n{URL1}\n"], block=True),
    )
    try:
        threading.Thread(target=launcher._monitor, daemon=True).start()
        assert launcher.wait_for_url(timeout=5) == URL1
        assert launcher.urls == [URL1]
    finally:
        launcher.stop()


def test_monitor_reprints_fresh_url_on_reconnect():
    # first tunnel drops (EOF) -> restart -> second tunnel prints a new URL
    fakes = iter(
        [
            FakeTunnel([f"line\n{URL1}\n"], block=False),
            FakeTunnel([f"{URL2}\n"], block=True),
        ]
    )
    launcher = ColabLauncher(
        registry={"fake": {"cwd": "/tmp", "engine": "direct", "entry": "x.py"}},
        db="/tmp/db.sqlite",
        artifacts_dir="/tmp/art",
        token="t",
        restart_delay=0.1,
        print_fn=quiet,
        process_factory=lambda: next(fakes),
    )
    try:
        threading.Thread(target=launcher._monitor, daemon=True).start()
        assert launcher.wait_for_url(timeout=5) == URL1
        deadline = time.monotonic() + 5
        while len(launcher.urls) < 2 and time.monotonic() < deadline:
            time.sleep(0.05)
        assert launcher.urls == [URL1, URL2]
    finally:
        launcher.stop()


def test_stop_terminates_monitor():
    launcher = ColabLauncher(
        registry={"fake": {"cwd": "/tmp", "engine": "direct", "entry": "x.py"}},
        db="/tmp/db.sqlite",
        artifacts_dir="/tmp/art",
        token="t",
        print_fn=quiet,
        process_factory=lambda: FakeTunnel([f"{URL1}\n"], block=True),
    )
    thread = threading.Thread(target=launcher._monitor, daemon=True)
    thread.start()
    assert launcher.wait_for_url(timeout=5) == URL1
    launcher.stop()
    thread.join(timeout=5)
    assert not thread.is_alive()


def test_launch_starts_service_health_ok(tmp_path):
    """Integration: real service thread + fake tunnel -> URL + /health 200."""
    port = free_port()
    registry = {"fake": {"cwd": str(tmp_path), "engine": "direct", "entry": "x.py"}}
    launcher = launch(
        registry=registry,
        port=port,
        token="t",
        db=tmp_path / "db.sqlite",
        artifacts_dir=tmp_path / "artifacts",
        print_fn=quiet,
        process_factory=lambda: FakeTunnel([f"{URL1}\n"], block=True),
    )
    try:
        assert launcher.wait_for_url(timeout=10) == URL1
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=5) as res:
            assert res.status == 200
            body = json.loads(res.read())
            assert body["service"] == "studio-backend"
            assert body["authEnabled"] is True
    finally:
        launcher.stop()
