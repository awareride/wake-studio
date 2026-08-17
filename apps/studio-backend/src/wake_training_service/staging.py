"""Module asset provisioning (staging) for generic runtimes (#159).

A Colab/generic runtime has no repo checkout; before the first job for a
registered module, :class:`ModuleStager` provisions the module's assets from
the repo tarball (extracted under ``staged_root``). The tarball revision is
resolved by :func:`staging_revision`:

1. **REVISION** - the Colab Params-form value, passed via the ``WAKE_REVISION``
   env var (the user's explicit choice; default source whenever present),
2. **baked wheel revision** - the commit the installed service was built from
   (hatch build hook -> ``_revision.py``), so wheel and staged code never
   drift, and
3. **main** - last-resort fallback (plain directory/sdist builds).

Split out of ``registry.py`` so the registry stays "how to run a module" and
this stays "how to provision its assets" (ADR-028/036, #159).
"""

from __future__ import annotations

import os
import tarfile
import urllib.request
from pathlib import Path
from typing import Any, Callable

from .registry import RegistryError


def baked_revision() -> str:
    """The git revision the installed wheel was built from ("" if unknown)."""
    try:
        from wake_training_service import _revision  # type: ignore[attr-defined]

        return getattr(_revision, "REVISION", "") or ""
    except Exception:  # noqa: BLE001 - baked file missing (repo checkout / sdist)
        return ""


def staging_revision() -> str:
    """Revision used for module staging: REVISION env > baked wheel > main.

    The Colab launcher notebook passes the Params-form ``REVISION`` value via
    ``WAKE_REVISION`` (option A', #159) so the user's explicit choice is the
    default source; self-hosted/CLI runs without the env use the wheel's baked
    revision (identical when the wheel was built from the pinned commit).
    """
    override = os.environ.get("WAKE_REVISION", "").strip()
    if override:
        return override
    return baked_revision() or "main"


def repo_tarball_url(revision: str | None = None) -> str:
    """GitHub API tarball endpoint - accepts a branch, tag, or commit SHA."""
    return (
        "https://api.github.com/repos/awareride/wake-studio/tarball/"
        f"{revision or staging_revision()}"
    )


def _default_fetch(url: str, dest: Path) -> None:
    """Stream-download a URL to ``dest`` (stdlib; follows redirects)."""
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

    On the first job for a module with a ``stage`` spec, the repo tarball is
    fetched once (at :func:`staging_revision`) and the module's declared paths
    are extracted under ``staged_root``. Subsequent jobs reuse the staged tree
    (idempotent, no re-fetch).

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
                    m.name
                    for m in tf.getmembers()
                    if m.name == prefix or m.name.startswith(prefix + "/")
                )
            members = [m for m in tf.getmembers() if m.name in wanted]
            for m in members:
                m.name = m.name[len(top) + 1:]
            try:
                tf.extractall(self.staged_root, members=members, filter="data")
            except TypeError:  # python < 3.12 (tarfile without filter kwarg)
                tf.extractall(self.staged_root, members=members)
            self.staged_root.mkdir(parents=True, exist_ok=True)
