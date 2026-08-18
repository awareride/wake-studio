#!/usr/bin/env python3
"""openwakeword module convert script (ADR-039 §4.6, spec.train.convert).

Standalone counterpart to the train-time bundle: given an already-trained
canonical ``model.onnx``, derive the additional target formats the module
declares in ``spec.train.convert`` (today: an fp16 variant via onnxruntime).

The quantized ``tflite-int8`` is produced by the upstream train itself (the
canonical artifact is onnx + upstream tflite), so this script only derives
what is NOT already produced upstream:

    python convert.py path/to/model.onnx --output path/to/model-fp16.onnx

Requires ``onnxruntime`` (a convert-stage dependency, not a train-env one).
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from wake_train_kit.convert import ConvertError, onnx_fp16

DESCRIPTION = "Derive an fp16 ONNX from a trained openwakeword model (ADR-039 §4.6)."


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=DESCRIPTION)
    parser.add_argument("onnx", type=Path, help="canonical model.onnx (from a bundle)")
    parser.add_argument("--output", "-o", type=Path, default=None, help="output fp16 .onnx path")
    args = parser.parse_args(argv)

    out = args.output or args.onnx.with_name(f"{args.onnx.stem}-fp16.onnx")
    try:
        result = onnx_fp16(args.onnx, out)
    except ConvertError as exc:
        print(f"[openwakeword convert] ERROR: {exc}", file=sys.stderr)
        return 1
    print(f"[openwakeword convert] ok: {result}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
