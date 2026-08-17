"""Hatch build hook: bake the source git revision into the wheel (#159, option A).

The pip-installed service records the exact commit it was built from, so
ModuleStager can stage module assets from THAT SAME commit - the installed
wheel and the staged module code can never drift (one shared revision).

pip's git builds check out the pinned ref (e.g. a notebook-embedded SHA), so
``git rev-parse HEAD`` yields the exact revision; plain-directory/sdist builds
without git metadata fall back to "main" (matching the historical behaviour).
The generated ``src/wake_training_service/_revision.py`` is gitignored and
regenerated on every build.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

from hatchling.builders.hooks.plugin.interface import BuildHookInterface


class BakeRevisionHook(BuildHookInterface):
    def initialize(self, version: str, build_data: dict) -> None:
        revision = "main"
        try:
            out = subprocess.run(
                ["git", "rev-parse", "HEAD"],
                cwd=str(self.root),
                capture_output=True,
                text=True,
                timeout=15,
            )
            if out.returncode == 0 and out.stdout.strip():
                revision = out.stdout.strip()
        except Exception:  # noqa: BLE001 - any git failure falls back to main
            pass
        target = Path(self.root) / "src" / "wake_training_service" / "_revision.py"
        target.write_text(
            "# Build-time source revision (baked by hatch_build.py, #159).\n"
            "# Do not edit - regenerated on every wheel build.\n"
            f"REVISION = {revision!r}\n"
        )
