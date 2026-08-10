#!/usr/bin/env python3
"""Validate an exported kws-streaming ONNX model against REAL audio.

Structural conversion is not correctness: a graph can convert cleanly, verify on
a zeros input, and still be numerically wrong (bad weight layout, a dropped
transform, the wrong output column order). This script closes that gap by
running the exported ONNX over real Speech Commands clips and asserting the
model actually recognises the words its labels claim.

It runs in CI right after the export (see build-kws-streaming.mjs), so a bogus
artifact never reaches the registry - let alone the browser.

Checks, in order of strictness:
  1. Per-clip argmax accuracy over N clips per wanted label.
  2. The target label's softmax probability on its own clips (mean).
  3. A silence sanity check: zeros must not fire a wake word confidently.

Exit non-zero if accuracy is below --min-accuracy, so the build fails loudly.
"""

from __future__ import annotations

import argparse
import json
import sys
import tarfile
import urllib.request
import wave
from pathlib import Path

SPEECH_COMMANDS_V2 = (
    "https://storage.googleapis.com/download.tensorflow.org/data/"
    "speech_commands_v0.02.tar.gz"
)


def log(msg: str) -> None:
    print(f"[validate-kws-streaming] {msg}", flush=True)


def die(msg: str) -> None:
    print(f"[validate-kws-streaming] ERROR: {msg}", file=sys.stderr)
    raise SystemExit(1)


def download_dataset(dest: Path, labels: list[str], per_label: int) -> Path:
    """Fetch Speech Commands and extract only the clips we need."""
    dest.mkdir(parents=True, exist_ok=True)
    archive = dest / "speech_commands_v0.02.tar.gz"
    if not archive.exists():
        log(f"downloading Speech Commands V2 (~2.3 GB) -> {archive}")
        urllib.request.urlretrieve(SPEECH_COMMANDS_V2, archive)
    extract_dir = dest / "clips"
    if extract_dir.exists():
        return extract_dir
    extract_dir.mkdir(parents=True, exist_ok=True)
    wanted = {l for l in labels if not l.startswith("_")}
    counts = {l: 0 for l in wanted}
    log(f"extracting up to {per_label} clips for each of {sorted(wanted)}")
    with tarfile.open(archive, "r:gz") as tar:
        for member in tar:
            if not member.name.endswith(".wav"):
                continue
            parts = member.name.split("/")
            if len(parts) < 2:
                continue
            label = parts[-2]
            if label not in wanted or counts[label] >= per_label:
                continue
            member.name = f"{label}/{Path(member.name).name}"
            tar.extract(member, extract_dir)
            counts[label] += 1
            if all(c >= per_label for c in counts.values()):
                break
    log(f"extracted: { {k: v for k, v in counts.items()} }")
    return extract_dir


def read_wav_16k(path: Path, target_len: int) -> "list[float]":
    """Read a 16 kHz mono PCM16 wav into float32 [-1,1], padded/cropped."""
    import numpy as np

    with wave.open(str(path), "rb") as w:
        if w.getframerate() != 16000 or w.getnchannels() != 1:
            die(f"{path}: expected 16 kHz mono, got {w.getframerate()} Hz {w.getnchannels()}ch")
        frames = w.readframes(w.getnframes())
    audio = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
    if len(audio) < target_len:
        audio = np.pad(audio, (0, target_len - len(audio)))
    return audio[:target_len]


def softmax(x):
    import numpy as np

    e = np.exp(x - np.max(x))
    return e / e.sum()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--onnx", required=True)
    ap.add_argument("--manifest", required=True)
    ap.add_argument("--data-dir", default="/tmp/speech_commands")
    ap.add_argument("--per-label", type=int, default=10)
    ap.add_argument(
        "--min-accuracy",
        type=float,
        default=0.8,
        help="minimum argmax accuracy over the sampled clips",
    )
    args = ap.parse_args()

    import numpy as np
    import onnxruntime as ort

    manifest = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
    labels: list[str] = manifest["labels"]
    window = int(manifest.get("windowSamples") or 16000)
    in_name = manifest["audioInput"]
    softmaxed = bool(manifest["softmaxed"])

    log(f"model: {args.onnx}")
    log(f"labels: {labels}")
    log(f"window: {window} samples, input '{in_name}', softmaxed={softmaxed}")

    clips_dir = download_dataset(Path(args.data_dir), labels, args.per_label)

    sess = ort.InferenceSession(args.onnx, providers=["CPUExecutionProvider"])

    total = 0
    correct = 0
    per_label_stats: dict[str, dict] = {}

    for label in labels:
        if label.startswith("_"):
            continue
        label_dir = clips_dir / label
        if not label_dir.is_dir():
            log(f"WARN: no clips for '{label}', skipping")
            continue
        idx = labels.index(label)
        hits = 0
        probs = []
        wavs = sorted(label_dir.glob("*.wav"))[: args.per_label]
        for wav in wavs:
            audio = read_wav_16k(wav, window)
            out = sess.run(None, {in_name: audio.reshape(1, -1)})[0][0]
            p = out if softmaxed else softmax(out)
            pred = int(np.argmax(p))
            probs.append(float(p[idx]))
            if pred == idx:
                hits += 1
            total += 1
            correct += 1 if pred == idx else 0
        per_label_stats[label] = {
            "clips": len(wavs),
            "accuracy": hits / max(1, len(wavs)),
            "mean_target_prob": sum(probs) / max(1, len(probs)),
        }
        log(
            f"  {label:>6}: {hits}/{len(wavs)} correct, "
            f"mean p({label})={per_label_stats[label]['mean_target_prob']:.3f}"
        )

    if total == 0:
        die("no clips evaluated - dataset extraction failed")

    accuracy = correct / total
    log(f"OVERALL: {correct}/{total} = {accuracy:.1%} argmax accuracy")

    # Silence sanity: zeros must not confidently fire a real wake word.
    zeros = np.zeros((1, window), dtype=np.float32)
    out = sess.run(None, {in_name: zeros})[0][0]
    p = out if softmaxed else softmax(out)
    word_idx = [i for i, l in enumerate(labels) if not l.startswith("_")]
    max_word_prob = float(max(p[i] for i in word_idx))
    top = labels[int(np.argmax(p))]
    log(f"silence check: top label '{top}', max wake-word prob {max_word_prob:.3f}")
    if max_word_prob > 0.5:
        die(
            f"silence produced a confident wake word ({max_word_prob:.3f}) - "
            "the export is numerically wrong"
        )

    if accuracy < args.min_accuracy:
        die(
            f"accuracy {accuracy:.1%} is below the {args.min_accuracy:.0%} threshold - "
            "the conversion is numerically wrong, not just structurally valid"
        )

    log(f"PASS: real-audio accuracy {accuracy:.1%}")


if __name__ == "__main__":
    main()
