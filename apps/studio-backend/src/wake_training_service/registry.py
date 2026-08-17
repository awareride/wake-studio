"""Module registry - maps module_id to a train command (ADR-028/036).

The registry is a JSON file (--registry). Each entry declares how to invoke
the module's train script:

    {
      "kws-openwakeword": {
        "cwd":   "/abs/or/repo-relative/workdir",
        "engine": "uv" | "direct",          // uv = `uv run <entry>` (ADR-028);
                                            // direct = `<python> <entry>` (tests/dev)
        "entry": "train/train.py",
        "args":  ["--epochs", "{params.epochs}"],   // optional; {params.X} templating
        "env":   { "DATA_DIR": "{env.DATA_DIR}" }   // optional; {params.X}/{env.Y}
      }
    }

Job params also flow to the script as env vars: WAKE_PARAMS (JSON) and one
WAKE_<UPPER_KEY> per param - matching the notebook env convention
(docs/modules/training.md 4.1 "env"). The spec.train contract
(module.spec.json) remains the source of truth in the repo; the registry is
the service's runtime view of it (a future step can generate it from specs).
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any

_TMPL = re.compile(r"\{([^}]+)\}")


class RegistryError(ValueError):
    pass


def _render(template: str, params: dict[str, str], env: dict[str, str]) -> str:
    def sub(m: re.Match[str]) -> str:
        key = m.group(1)
        if key.startswith("params."):
            return str(params.get(key[7:], ""))
        if key.startswith("env."):
            return str(env.get(key[4:], ""))
        return str(env.get(key, ""))
    return _TMPL.sub(sub, template)


class Registry:
    def __init__(self, entries: dict[str, Any], base_dir: str | Path | None = None) -> None:
        self.entries = entries
        self.base_dir = Path(base_dir) if base_dir else Path.cwd()

    @classmethod
    def load(cls, path: str | Path, base_dir: str | Path | None = None) -> "Registry":
        raw = json.loads(Path(path).read_text())
        base = base_dir or Path(path).resolve().parent
        return cls(raw, base_dir=base)

    def modules(self) -> list[dict[str, Any]]:
        return [
            {"moduleId": mid, "entry": e.get("entry"), "engine": e.get("engine", "uv")}
            for mid, e in sorted(self.entries.items())
        ]

    def has(self, module_id: str) -> bool:
        return module_id in self.entries

    def resolve(self, module_id: str, params: dict[str, str]) -> tuple[list[str], str, dict[str, str]]:
        """-> (command list, cwd, env dict) for the train subprocess."""
        entry = self.entries.get(module_id)
        if not entry:
            raise RegistryError(f"unknown module '{module_id}' in registry")

        cwd = Path(entry.get("cwd", "."))
        if not cwd.is_absolute():
            cwd = self.base_dir / cwd
        cwd = cwd.resolve()
        if not cwd.is_dir():
            raise RegistryError(f"module '{module_id}' cwd does not exist: {cwd}")

        env = dict(os.environ)
        for k, v in entry.get("env", {}).items():
            env[k] = _render(v, params, env)
        # params as env vars (notebook convention)
        env["WAKE_PARAMS"] = json.dumps(params)
        for k, v in params.items():
            env[f"WAKE_{k.upper()}"] = v

        engine = entry.get("engine", "uv")
        script = entry.get("entry")
        if not script:
            raise RegistryError(f"module '{module_id}' registry entry has no 'entry'")

        cmd: list[str]
        if engine == "direct":
            cmd = [sys_executable(), str(cwd / script)]
        else:  # uv (ADR-028)
            cmd = ["uv", "run"]
            for extra in entry.get("extras", []):
                cmd += ["--extra", str(extra)]
            cmd.append(str(cwd / script))

        for arg in entry.get("args", []):
            cmd.append(_render(arg, params, env))
        return cmd, str(cwd), env


def sys_executable() -> str:
    import sys
    return sys.executable
