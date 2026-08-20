"""wake_train_kit.postprocess — dataset post-processing transforms (ADR-044 §5.2, #205).

Composable after ANY TTS engine: transforms run over the canonical
``label/*.wav`` tree in place. The transform list is engine-agnostic (a
pipeline stage, not a vendor) so ``passthrough`` / ``openwakeword-style``
apply to edge-tts, online HTTP TTS and LLM-TTS alike.
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path
from typing import Any

from .data_sources import DataSourceError


def _log(reporter: Any, level: str, message: str) -> None:
    if reporter is not None and hasattr(reporter, "emit"):
        reporter.emit("log", level=level, message=message)
    elif reporter is not None and hasattr(reporter, "log"):
        reporter.log(level=level, message=message)


def _has_tool(name: str) -> bool:
    return shutil.which(name) is not None


def _openwakeword_style_perturb(src: Path, dst: Path, seed: int = 0) -> None:
    """One perturbed variant (pitch + rate + volume), openwakeword-style.

    Uses ffmpeg when available (asetrate + atempo preserves duration, volume
    scales loudness). Mirrors the spirit of openwakeword's `augment.py` (random
    pitch/rate/volume perturbation per clip) without depending on sox.
    """
    import random

    rng = random.Random(seed)
    pitch = rng.uniform(0.92, 1.08)  # ~ ±8%
    volume = rng.uniform(0.8, 1.2)
    # asetrate changes pitch by shifting sample rate; atempo restores duration.
    cmd = [
        "ffmpeg", "-y", "-i", str(src),
        "-af",
        f"asetrate=44100*{pitch:.4f},atempo={1 / pitch:.4f},volume={volume:.4f}",
        str(dst),
    ]
    subprocess.run(
        cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
    )


def apply_postprocess(
    transform: str,
    data_root: Path,
    reporter: Any = None,
    seed: int = 0,
) -> None:
    """Apply a named transform over the ``label/*.wav`` tree in place.

    ``data_root`` is the canonical root holding ``<label>/<clip>.wav`` folders
    (the output of a TTS engine's synthesize step). Supported transforms:
      - "passthrough": no-op (identity).
      - "openwakeword-style": one perturbed variant per clip (pitch + rate +
        volume) written as ``<name>__aug<seed>.wav`` next to the source.
    """
    root = Path(data_root)
    if transform in (None, "", "passthrough"):
        _log(reporter, "info", f"postprocess: passthrough (no transform)")
        return

    if transform == "openwakeword-style":
        if not _has_tool("ffmpeg"):
            raise DataSourceError(
                "postprocess 'openwakeword-style' requires ffmpeg "
                "(pitch/rate/volume perturbation); install ffmpeg or pick "
                "'passthrough'"
            )
        n = 0
        for label_dir in sorted(p for p in root.iterdir() if p.is_dir()):
            for wav in sorted(label_dir.glob("*.wav")):
                if "__aug" in wav.name:
                    continue  # never re-augment an augmented clip
                dst = label_dir / f"{wav.stem}__aug{seed}{wav.suffix}"
                try:
                    _openwakeword_style_perturb(wav, dst, seed=seed)
                    n += 1
                    if reporter is not None and hasattr(reporter, "heartbeat"):
                        reporter.heartbeat()
                except subprocess.CalledProcessError as exc:
                    raise DataSourceError(
                        f"postprocess perturb failed for {wav}: {exc}"
                    ) from exc
        _log(reporter, "info", f"postprocess: openwakeword-style wrote {n} augmented clips")
        return

    raise DataSourceError(f"unknown postprocess transform: '{transform}'")
