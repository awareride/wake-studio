"""wake_training_service.registry tests (ADR-028/036)."""

from pathlib import Path

import pytest

from wake_training_service import registry
from wake_training_service.registry import Registry


def test_direct_engine_uses_service_python(tmp_path):
    reg = Registry({"m": {"cwd": str(tmp_path), "engine": "direct", "entry": "s.py"}})
    cmd, cwd, _ = reg.resolve("m", {})
    assert "python" in Path(cmd[0]).name
    assert cmd[-1].endswith("s.py")
    assert str(cwd) == str(tmp_path.resolve())


def test_uv_engine_builds_uv_run_with_extras(tmp_path):
    reg = Registry(
        {
            "m": {
                "cwd": str(tmp_path),
                "engine": "uv",
                "extras": ["tf", "tts"],
                "entry": "s.py",
            }
        }
    )
    cmd, cwd, _ = reg.resolve("m", {})
    assert cmd[:2] == ["uv", "run"]
    assert cmd[2:6] == ["--extra", "tf", "--extra", "tts"]
    assert cmd[-1].endswith("s.py")


def test_uv_engine_without_extras(tmp_path):
    reg = Registry({"m": {"cwd": str(tmp_path), "engine": "uv", "entry": "s.py"}})
    cmd, _, _ = reg.resolve("m", {})
    assert cmd == ["uv", "run", str(tmp_path.resolve() / "s.py")]


def test_params_env_templating(tmp_path):
    reg = Registry(
        {
            "m": {
                "cwd": str(tmp_path),
                "engine": "direct",
                "entry": "s.py",
                "env": {"A": "{params.a}", "B": "{env.X}", "C": "literal"},
            }
        }
    )
    _, _, env = reg.resolve("m", {"a": "1"})
    assert env["A"] == "1"
    assert env["B"] == ""  # {env.X} with X unset renders empty
    assert env["C"] == "literal"


def test_repo_tarball_url_pins_revision():
    # a SHA pins the tarball to that commit (GitHub API endpoint)
    url = registry.repo_tarball_url("abc123")
    assert url == "https://api.github.com/repos/awareride/wake-studio/tarball/abc123"


def test_repo_tarball_url_falls_back_to_baked_or_main(monkeypatch):
    # no baked _revision (repo checkout / sdist) -> main
    monkeypatch.setattr(registry, "_baked_revision", lambda: "main")
    assert registry.repo_tarball_url().endswith("/tarball/main")
    # baked revision (wheel build) wins
    monkeypatch.setattr(registry, "_baked_revision", lambda: "deadbeef")
    assert registry.repo_tarball_url().endswith("/tarball/deadbeef")


def test_staging_revision_prefers_env_override(monkeypatch):
    # the Colab form passes WAKE_REVISION - explicit choice wins over baked
    monkeypatch.setattr(registry, "_baked_revision", lambda: "deadbeef")
    monkeypatch.setenv("WAKE_REVISION", "cafebabe")
    assert registry._staging_revision() == "cafebabe"
    assert registry.repo_tarball_url().endswith("/tarball/cafebabe")


def test_staging_revision_falls_back_to_baked_without_env(monkeypatch):
    monkeypatch.delenv("WAKE_REVISION", raising=False)
    monkeypatch.setattr(registry, "_baked_revision", lambda: "deadbeef")
    assert registry._staging_revision() == "deadbeef"


def test_staging_revision_ignores_blank_env(monkeypatch):
    monkeypatch.setenv("WAKE_REVISION", "  ")
    monkeypatch.setattr(registry, "_baked_revision", lambda: "deadbeef")
    assert registry._staging_revision() == "deadbeef"


def test_stager_default_url_uses_repo_tarball_url(monkeypatch, tmp_path):
    monkeypatch.setattr(registry, "repo_tarball_url", lambda: "https://example.com/tarball/x")
    stager = registry.ModuleStager(staged_root=tmp_path / "staged")
    assert stager.repo_url == "https://example.com/tarball/x"
