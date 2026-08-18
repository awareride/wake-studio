#!/usr/bin/env python3
"""kws-streaming module convert script (ADR-039 §4.6, spec.train.convert).

Standalone counterpart to the train-time derive: given an already-trained
canonical ``model.tflite`` (from a bundle or an upstream run dir), derive the
target formats the module declares in ``spec.train.convert`` (tflite -> onnx
for the in-browser test + browser export row).

Reuses the shared ``wake_train_kit.convert.tflite_to_onnx`` transform (the
same one the CI export path uses). Run it in an env that has tf2onnx:

    python convert.py path/to/model.tflite --output path/to/model.onnx

When tf2onnx is missing, a :class:`ConvertError` is raised with a clear
message — run the convert stage env instead of the train env.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from wake_train_kit.convert import ConvertError, tflite_to_onnx

DESCRIPTION = "Derive ONNX from a trained kws-streaming TFLite model (ADR-039 §4.6)."


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=DESCRIPTION)
    parser.add_argument("tflite", type=Path, help="canonical model.tflite (from a bundle)")
    parser.add_argument("--output", "-o", type=Path, default=None, help="output .onnx path")
    parser.add_argument("--opset", type=int, default=17, help="ONNX opset (default 17)")
    args = parser.parse_args(argv)

    out = args.output or args.tflite.with_suffix(".onnx")
    try:
        result = tflite_to_onnx(args.tflite, out, opset=args.opset)
    except ConvertError as exc:
        print(f"[kws-streaming convert] ERROR: {exc}", file=sys.stderr)
        return 1
    print(f"[kws-streaming convert] ok: {result}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
