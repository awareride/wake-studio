"""wake_train_kit.convert - shared model-format transforms (ADR-039 §4.6).

Each helper is a SPECIFIC, well-defined transform, not a universal router:
onnx<->tflite is lossy and one-way-ish, so module convert scripts compose
these and declare their source->target pairs in ``spec.train.convert``.

Heavy toolchains (tf2onnx, the TF converter, onnxruntime) are imported /
invoked lazily, so this module can be imported anywhere (including the
studio-backend tests, which exercise the orchestration with fakes). A missing
toolchain raises :class:`ConvertError` with a clear message, so callers can
decide to fall back (e.g. skip a train-time derive and defer to the convert
stage) instead of crashing.

Conventions: every function returns the output :class:`pathlib.Path` and
raises :class:`ConvertError` (never silently succeeding) on any failure.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path
from typing import Iterable

__all__ = [
    "ConvertError",
    "tflite_to_onnx",
    "onnx_fp16",
    "snapshot_calibration",
]


class ConvertError(RuntimeError):
    """A conversion failed (missing toolchain, bad input, converter error)."""


def tflite_to_onnx(tflite: str | Path, onnx_out: str | Path, opset: int = 17) -> Path:
    """TFLite -> ONNX via tf2onnx's TFLite front-end (``--tflite``).

    The same transform the kws-streaming CI export uses
    (``packages/modules/kws/streaming/scripts/export-kws-streaming-onnx.py``),
    lifted here so any module can reuse it. Requires ``tf2onnx`` on
    ``sys.executable``; when it is missing, :class:`ConvertError` is raised
    with a hint to run the convert stage (which installs the toolchain).
    """
    tflite, onnx_out = Path(tflite), Path(onnx_out)
    if not tflite.is_file():
        raise ConvertError(f"tflite not found: {tflite}")
    cmd = [
        sys.executable,
        "-m",
        "tf2onnx.convert",
        "--tflite",
        str(tflite),
        "--output",
        str(onnx_out),
        "--opset",
        str(opset),
        "--dequantize",
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=900)
    except FileNotFoundError as exc:  # pragma: no cover - env without python
        raise ConvertError(f"python not found: {sys.executable}") from exc
    except subprocess.TimeoutExpired as exc:
        raise ConvertError(f"tf2onnx timed out for {tflite}") from exc
    if proc.returncode != 0:
        tail = (proc.stderr or proc.stdout or "").strip().splitlines()[-10:]
        raise ConvertError(
            f"tf2onnx failed ({proc.returncode}) for {tflite}: {' | '.join(tail)}"
        )
    if not onnx_out.is_file():
        raise ConvertError(f"tf2onnx reported success but produced no {onnx_out}")
    return onnx_out


def onnx_fp16(onnx: str | Path, out: str | Path) -> Path:
    """ONNX fp32 -> fp16 via onnxruntime quantization (lazy import)."""
    onnx, out = Path(onnx), Path(out)
    if not onnx.is_file():
        raise ConvertError(f"onnx not found: {onnx}")
    try:
        from onnxruntime.quantization import quantize_dynamic  # type: ignore
    except ImportError as exc:
        raise ConvertError(
            "onnxruntime is not installed; run the convert stage env "
            "(onnxruntime>=1.16) to enable fp16"
        ) from exc
    quantize_dynamic(onnx.__str__(), out.__str__(), weight_type="FLOAT16")
    if not out.is_file():
        raise ConvertError(f"fp16 quantization produced no {out}")
    return out


def snapshot_calibration(
    wav_paths: Iterable[str | Path],
    out_dir: str | Path,
    *,
    max_seconds: float = 30.0,
    sample_rate: int = 16000,
) -> list[Path]:
    """Copy a tiny representative audio set for later post-training
    quantization (ADR-039 §4.6 / §6 ``calibration/``).

    Copies up to ``max_seconds`` of 16 kHz wav data (a handful of clips) into
    ``out_dir`` so a later standalone convert can run int8 static PTQ without
    the training data. Callers pass their run's positive/negative wavs; a
    best-effort selection is made (clip length is read from the 44-byte wav
    header when present). Missing/invalid files are skipped.
    """
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    copied: list[Path] = []
    budget = max_seconds * sample_rate
    used = 0
    for src in wav_paths:
        if used >= budget:
            break
        p = Path(src)
        if not p.is_file():
            continue
        seconds = _wav_seconds(p)
        if seconds is None or seconds <= 0:
            continue
        if used + seconds * sample_rate > budget:
            # keep partial? take whole clip if we still have room for > 0
            if used + seconds * sample_rate > budget and used > 0:
                continue
        dst = out / p.name
        try:
            dst.write_bytes(p.read_bytes())
        except OSError:
            continue
        copied.append(dst)
        used += seconds * sample_rate
    return copied


def _wav_seconds(path: Path) -> float | None:
    """Best-effort duration from a 44-byte PCM wav header (bytes 28..31)."""
    try:
        with path.open("rb") as fh:
            riff = fh.read(44)
    except OSError:
        return None
    if len(riff) < 44 or riff[0:4] != b"RIFF" or riff[8:12] != b"WAVE":
        return None
    byte_rate = int.from_bytes(riff[28:32], "little")
    data_size = int.from_bytes(riff[40:44], "little")
    if byte_rate <= 0:
        return None
    return data_size / byte_rate
