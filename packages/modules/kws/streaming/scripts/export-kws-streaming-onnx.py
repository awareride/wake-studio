#!/usr/bin/env python3
"""Convert a `kws_streaming`-family TFLite checkpoint to ONNX + sidecar manifest.

Runs in CI only (see .github/workflows/build.yaml + build-kws-streaming.mjs):
TensorFlow has no arm64-macOS wheels for the pinned versions, so dev machines
never run this - they fetch the artifact (ADR-027 SOP).

Input : a checkpoint directory in upstream's layout, i.e. what
        `kws_streaming/train/model_train_eval.py` writes and what
        ARM-software/keyword-transformer publishes under
        `models_data_v2_12_labels/<model>/`:
            flags.json                              (training flags)
            labels.txt                              (class labels, one per line)
            tflite_non_stream/non_stream.tflite      (non-streaming graph)
            tflite_stream_state_external/stream_state_external.tflite  (optional)

Output: <out>/<name>.onnx  + <out>/<name>.json (the driver's sidecar manifest,
        see docs/modules/kws-streaming.md §4.2)

Why TFLite -> ONNX rather than shipping a TFLite runtime: the repo already
vendors onnxruntime-web for the openwakeword/plix drivers, and these graphs use
`feature_type: mfcc_tf`, which upstream documents as DFT/DCT implemented with
matrix multiplications - "compatible with any inference engine". So the graph is
plain matmul/dense ops with no custom TFLite kernels to emulate.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path


def die(msg: str) -> None:
    print(f"[export-kws-streaming] ERROR: {msg}", file=sys.stderr)
    raise SystemExit(1)


def log(msg: str) -> None:
    print(f"[export-kws-streaming] {msg}", flush=True)


def read_labels(checkpoint: Path) -> list[str]:
    labels_file = checkpoint / "labels.txt"
    if not labels_file.exists():
        die(f"missing {labels_file}")
    labels = [
        line.strip()
        for line in labels_file.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    if not labels:
        die(f"{labels_file} is empty")
    return labels


def read_flags(checkpoint: Path) -> dict:
    flags_file = checkpoint / "flags.json"
    if not flags_file.exists():
        die(f"missing {flags_file}")
    return json.loads(flags_file.read_text(encoding="utf-8"))


def convert_tflite_to_onnx(tflite: Path, onnx_out: Path, opset: int) -> None:
    """Convert with tf2onnx's TFLite front-end (`--tflite`)."""
    log(f"tf2onnx: {tflite} -> {onnx_out} (opset {opset})")
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
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        # tf2onnx is noisy; surface both streams so a conversion gap is
        # diagnosable from the CI log alone.
        print(proc.stdout, file=sys.stderr)
        print(proc.stderr, file=sys.stderr)
        die(f"tf2onnx failed ({proc.returncode}) for {tflite}")
    log("tf2onnx: ok")


def describe_onnx(onnx_path: Path) -> tuple[str, str, list[int], int]:
    """Return (input_name, output_name, input_shape, output_classes)."""
    import onnx

    model = onnx.load(str(onnx_path))
    graph = model.graph

    initializers = {i.name for i in graph.initializer}
    inputs = [i for i in graph.input if i.name not in initializers]
    if len(inputs) != 1:
        die(
            "expected exactly 1 real graph input, got "
            f"{[i.name for i in inputs]} - a multi-input graph means this is a "
            "streaming (external-state) export; convert it with --mode streaming"
        )
    if len(graph.output) != 1:
        die(f"expected exactly 1 graph output, got {[o.name for o in graph.output]}")

    inp, out = inputs[0], graph.output[0]

    def shape_of(value) -> list[int]:
        dims = []
        for d in value.type.tensor_type.shape.dim:
            dims.append(d.dim_value if d.dim_value > 0 else -1)
        return dims

    in_shape = shape_of(inp)
    out_shape = shape_of(out)
    classes = out_shape[-1] if out_shape else -1
    return inp.name, out.name, in_shape, classes


def verify_onnx(onnx_path: Path, in_name: str, in_shape: list[int], classes: int) -> None:
    """Run one inference pass so a broken conversion fails the build, not the browser."""
    import numpy as np
    import onnxruntime as ort

    log("onnxruntime: verifying one inference pass")
    sess = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    shape = [d if d > 0 else 1 for d in in_shape]
    dummy = np.zeros(shape, dtype=np.float32)
    outputs = sess.run(None, {in_name: dummy})
    got = outputs[0]
    log(f"onnxruntime: output shape {got.shape}")
    if got.shape[-1] != classes:
        die(f"verification mismatch: output {got.shape[-1]} values, expected {classes}")
    if not np.isfinite(got).all():
        die("verification produced non-finite values")
    log("onnxruntime: ok")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", required=True, help="upstream checkpoint dir")
    ap.add_argument("--out", required=True, help="artifact output dir")
    ap.add_argument("--name", required=True, help="artifact base name, e.g. kwt1")
    ap.add_argument("--opset", type=int, default=17)
    ap.add_argument(
        "--mode",
        choices=["sliding-window", "streaming"],
        default="sliding-window",
        help="sliding-window uses tflite_non_stream/; streaming uses "
        "tflite_stream_state_external/ (not all checkpoints ship it)",
    )
    ap.add_argument("--source", default="", help="provenance string for the manifest")
    ap.add_argument("--upstream-ref", default="unknown")
    ap.add_argument(
        "--wanted-word",
        default="",
        help="default wake word; defaults to the first non-_silence_/_unknown_ label",
    )
    ap.add_argument(
        "--hop-ms",
        type=int,
        default=100,
        help="sliding-window re-evaluation period in ms",
    )
    args = ap.parse_args()

    checkpoint = Path(args.checkpoint)
    if not checkpoint.is_dir():
        die(f"checkpoint dir not found: {checkpoint}")
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    flags = read_flags(checkpoint)
    labels = read_labels(checkpoint)
    model_name = flags.get("model_name", "unknown")
    sample_rate = int(flags.get("sample_rate", 16000))
    clip_ms = int(flags.get("clip_duration_ms", 1000))
    preprocess = flags.get("preprocess", "raw")

    log(f"checkpoint: {checkpoint}")
    log(f"model_name={model_name} preprocess={preprocess} labels={len(labels)}")

    if preprocess != "raw":
        die(
            f"preprocess='{preprocess}' puts the feature extractor OUTSIDE the graph; "
            "the driver only supports 'raw' today (Q-KS-2)"
        )

    if args.mode == "sliding-window":
        tflite = checkpoint / "tflite_non_stream" / "non_stream.tflite"
        manifest_mode = "sliding-window"
    else:
        tflite = (
            checkpoint
            / "tflite_stream_state_external"
            / "stream_state_external.tflite"
        )
        manifest_mode = "streaming-external-state"
    if not tflite.exists():
        die(f"missing {tflite} (checkpoint does not ship this inference mode)")

    onnx_path = out_dir / f"{args.name}.onnx"
    convert_tflite_to_onnx(tflite, onnx_path, args.opset)

    in_name, out_name, in_shape, classes = describe_onnx(onnx_path)
    log(f"graph: input '{in_name}' {in_shape} -> output '{out_name}' ({classes} classes)")

    if classes != len(labels):
        die(
            f"graph outputs {classes} classes but labels.txt has {len(labels)} entries"
        )

    verify_onnx(onnx_path, in_name, in_shape, classes)

    # The window length is the graph's own input length when it is static
    # (upstream bakes clip_duration_ms into the non-streaming graph).
    window_samples = in_shape[-1] if in_shape and in_shape[-1] > 0 else None
    if window_samples is None:
        window_samples = int(sample_rate * clip_ms / 1000)
        log(f"dynamic input length; using clip_duration_ms -> {window_samples}")

    wanted = args.wanted_word
    if not wanted:
        wanted = next(
            (l for l in labels if l not in ("_silence_", "_unknown_")), labels[0]
        )
    if wanted not in labels:
        die(f"--wanted-word '{wanted}' is not in labels {labels}")

    # `return_softmax=0` in upstream flags means the graph emits logits; the
    # driver softmaxes. Some exports bake it in, hence the explicit flag.
    softmaxed = bool(flags.get("return_softmax", 0))

    manifest = {
        "version": 1,
        "mode": manifest_mode,
        "model": model_name,
        "source": args.source or str(checkpoint),
        "upstreamRef": args.upstream_ref,
        "labels": labels,
        "wantedWord": wanted,
        "sampleRate": sample_rate,
        "featureExtractor": "graph",
        "audioInput": in_name,
        "scoreOutput": out_name,
        "softmaxed": softmaxed,
    }
    if manifest_mode == "sliding-window":
        manifest["windowSamples"] = int(window_samples)
        manifest["hopSamples"] = int(sample_rate * args.hop_ms / 1000)
    else:
        die(
            "streaming-external-state manifests need per-state tensor pairing, "
            "which this exporter does not emit yet (no published checkpoint "
            "ships stream_state_external for the streamable topologies)"
        )

    manifest_path = out_dir / f"{args.name}.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    log(f"manifest -> {manifest_path}")

    # Keep provenance next to the artifact (accuracy + flags), so the registry
    # entry and the UI can cite real numbers.
    for extra in ("accuracy_last.txt", "flags.json", "labels.txt"):
        src = checkpoint / extra
        if src.exists():
            shutil.copy(src, out_dir / f"{args.name}.{extra}")

    size_mb = onnx_path.stat().st_size / 1024 / 1024
    log(f"done: {onnx_path.name} ({size_mb:.1f} MB) + {manifest_path.name}")


if __name__ == "__main__":
    main()
