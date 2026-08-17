"""wake_training_service.registry tests (ADR-028/036)."""

from pathlib import Path

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
