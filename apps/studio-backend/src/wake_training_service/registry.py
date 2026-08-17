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

Entries may declare a ``stage`` spec (generic runtimes - e.g. Colab - have no
repo checkout; the service stages the module's assets from the repo tarball
on demand, driven by the job's moduleId - see ModuleStager).
"""

from __future__ import annotations

import json
import os
import re
import tarfile
import urllib.request
from pathlib import Path
from typing import Any, Callable

_TMPL = re.compile(r"\{([^}]+)\}")

#: Repo tarball used by ModuleStager to stage module assets on demand.
#: Fetch from the GitHub API tarball endpoint at the service's OWN build
#: revision (baked into the wheel at build time, #159 option A) so the
#: installed wheel and the staged module code can never drift; falls back to
#: "main" when the revision metadata is absent (plain-directory builds).
def _baked_revision() -> str:
    try:
        from wake_training_service import _revision  # type: ignore[attr-defined]

        rev = getattr(_revision, "REVISION", "") or ""
    except Exception:  # noqa: BLE001 - baked file missing (repo checkout / sdist)
        rev = ""
    return rev if rev else "main"


def _staging_revision() -> str:
    """Revision used for module staging: explicit override > baked wheel > main.

    The Colab launcher notebook passes the Params-form ``REVISION`` value via
    ``WAKE_REVISION`` (option A', #159) so the user's explicit choice wins
    even if a stale wheel cached a different baked revision; self-hosted/CLI
    runs without the env fall back to the wheel's baked revision (the two are
    identical when the wheel was built from the pinned commit).
    """
    override = os.environ.get("WAKE_REVISION", "").strip()
    if override:
        return override
    return _baked_revision()


def repo_tarball_url(revision: str | None = None) -> str:
    """GitHub API tarball endpoint - accepts a branch, tag, or commit SHA."""
    return (
        "https://api.github.com/repos/awareride/wake-studio/tarball/"
        f"{revision or _staging_revision()}"
    )


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

    def entry(self, module_id: str) -> dict[str, Any]:
        entry = self.entries.get(module_id)
        if not entry:
            raise RegistryError(f"unknown module '{module_id}' in registry")
        return entry

    def resolve(
        self,
        module_id: str,
        params: dict[str, str],
        staged: tuple[Path, dict[str, str]] | None = None,
    ) -> tuple[list[str], str, dict[str, str]]:
        """-> (command list, cwd, env dict) for the train subprocess.

        ``staged`` = (cwd, env overrides) from ModuleStager for generic
        runtimes without a repo checkout; it replaces the entry cwd resolution
        and merges extra env vars (e.g. UPSTREAM_DIR for vendored upstreams).
        """
        entry = self.entry(module_id)

        if staged is not None:
            cwd, extra_env = staged
            cwd = cwd.resolve()
        else:
            cwd = Path(entry.get("cwd", "."))
            if not cwd.is_absolute():
                cwd = self.base_dir / cwd
            cwd = cwd.resolve()
        if not cwd.is_dir():
            raise RegistryError(f"module '{module_id}' cwd does not exist: {cwd}")

        env = dict(os.environ)
        for k, v in entry.get("env", {}).items():
            env[k] = _render(v, params, env)
        if staged is not None:
            env.update(extra_env)
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


def _default_fetch(url: str, dest: Path) -> None:
    """Stream-download a URL to ``dest`` (stdlib)."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": "wake-studio"})
    with urllib.request.urlopen(req, timeout=120) as res, dest.open("wb") as out:
        while True:
            chunk = res.read(1 << 16)
            if not chunk:
                break
            out.write(chunk)


class ModuleStager:
    """Stage registered-module assets on demand (generic runtimes, #159).

    A Colab/generic runtime has no repo checkout, so the notebook stays
    generic and the service provisions whatever module the job names: on the
    first job for a module with a ``stage`` spec, the repo tarball is fetched
    once and the module's declared paths are extracted under ``staged_root``.
    Subsequent jobs reuse the staged tree (idempotent, no re-fetch).

    Stage spec (per registry entry):

        "stage": {
          "paths": ["packages/modules/kws/streaming/train", "third_party/..."],
          "cwd":   "packages/modules/kws/streaming/train",   // staged-root-relative
          "env":   {"UPSTREAM_DIR": "third_party"}           // staged-root-relative
        }
    """

    def __init__(
        self,
        staged_root: str | Path,
        repo_url: str | None = None,
        fetch: Callable[[str, Path], None] | None = None,
    ) -> None:
        self.staged_root = Path(staged_root)
        self.repo_url = repo_url or repo_tarball_url()
        self._fetch = fetch or _default_fetch
        self._fetched = False

    def prepare(
        self, entry: dict[str, Any], base_dir: Path
    ) -> tuple[Path, dict[str, str]] | None:
        """-> (cwd, env overrides) if the entry stages assets, else None.

        Returns None for entries without a stage spec (local repo checkout
        layout - resolved against the registry base_dir as usual).
        """
        stage = entry.get("stage")
        if not stage:
            return None
        script = entry.get("entry")
        target = (self.staged_root / stage["cwd"]).resolve()
        if (target / script).is_file():
            return target, self._env_overrides(stage)
        self._ensure_tarball()
        self._extract(stage.get("paths", []))
        if not (target / script).is_file():
            raise RegistryError(
                f"staged module '{entry.get('name', '?')}' missing entry "
                f"{script} under {target}"
            )
        return target, self._env_overrides(stage)

    def _env_overrides(self, stage: dict[str, Any]) -> dict[str, str]:
        return {
            k: str((self.staged_root / v).resolve())
            for k, v in stage.get("env", {}).items()
        }

    def _ensure_tarball(self) -> None:
        if self._fetched:
            return
        dest = self.staged_root / "_download" / "wake-studio.tar.gz"
        dest.parent.mkdir(parents=True, exist_ok=True)
        self._fetch(self.repo_url, dest)
        self._fetched = True

    def _extract(self, paths: list[str]) -> None:
        """Extract repo-root-relative ``paths`` under staged_root (strip top dir)."""
        archive = self.staged_root / "_download" / "wake-studio.tar.gz"
        with tarfile.open(archive) as tf:
            top = next(
                (m.name.split("/", 1)[0] for m in tf.getmembers() if m.name.count("/")),
                None,
            )
            if not top:
                raise RegistryError(f"repo tarball {archive} is empty")
            wanted = set()
            for p in paths:
                prefix = f"{top}/{p.strip('/')}"
                wanted.update(
                    m.name for m in tf.getmembers() if m.name == prefix or m.name.startswith(prefix + "/")
                )
            members = [m for m in tf.getmembers() if m.name in wanted]
            for m in members:
                m.name = m.name[len(top) + 1:]
            try:
                tf.extractall(self.staged_root, members=members, filter="data")
            except TypeError:  # python < 3.12 (tarfile without filter kwarg)
                tf.extractall(self.staged_root, members=members)
            self.staged_root.mkdir(parents=True, exist_ok=True)


def sys_executable() -> str:
    import sys
    return sys.executable
