#!/usr/bin/env python3
"""wake-sdk-demo.py — Python demo for the device-side SDK (issue #187).

Streams 16 kHz mono PCM16 audio through the ctypes binding and prints score
samples + triggers. Exit code 0 when triggered, 1 otherwise (CI smoke).

Input is either a WAV file or raw S16_LE mono piped on stdin (Pi mic path):

  python3 wake-sdk-demo.py <input.wav> [--backend rms] [--model-dir models/]
  arecord -f S16_LE -r16000 -c1 -t raw | python3 wake-sdk-demo.py --stdin [--backend openwakeword --model-dir models/]

Usage: python3 wake-sdk-demo.py [input.wav|--stdin] [--threshold 0.5] [--min-duration 300]
         [--backend <id>] [--model-dir <dir>]
"""

from __future__ import annotations

import sys
import wave

sys.path.insert(0, __file__.rsplit("/", 1)[0] + "/..")  # repo packages/sdk
from wake_sdk import SDK  # noqa: E402


def read_wav16(path: str) -> tuple[list[int], int]:
    with wave.open(path, "rb") as w:
        assert w.getsampwidth() == 2, "16-bit PCM required"
        assert w.getframerate() == 16000, "16 kHz required"
        nch = w.getnchannels()
        raw = w.readframes(w.getnframes())
    samples = [int.from_bytes(raw[i:i + 2], "little", signed=True)
               for i in range(0, len(raw), 2)]
    if nch > 1:
        samples = samples[::nch]  # first channel (demo-grade downmix)
    return samples, nch


def read_stdin_raw() -> list[int]:
    """Read raw S16_LE mono 16 kHz PCM from stdin (the `arecord -t raw` pipe)."""
    raw = sys.stdin.buffer.read()
    if len(raw) % 2:
        raw = raw[:-1]  # drop a trailing partial sample (demo-grade)
    return [int.from_bytes(raw[i:i + 2], "little", signed=True)
            for i in range(0, len(raw), 2)]


def main() -> int:
    backend = "rms"
    model_dir = None
    use_stdin = False
    wav = None
    cfg: dict = {}
    i = 1
    while i < len(sys.argv):
        a = sys.argv[i]
        if a == "--threshold" and i + 1 < len(sys.argv):
            cfg["threshold"] = float(sys.argv[i + 1]); i += 2
        elif a == "--min-duration" and i + 1 < len(sys.argv):
            cfg["min_duration_ms"] = int(sys.argv[i + 1]); i += 2
        elif a == "--backend" and i + 1 < len(sys.argv):
            backend = sys.argv[i + 1]; i += 2
        elif a == "--model-dir" and i + 1 < len(sys.argv):
            model_dir = sys.argv[i + 1]; i += 2
        elif a == "--stdin":
            use_stdin = True; i += 1
        elif not a.startswith("--") and wav is None:
            wav = a; i += 1
        else:
            print(f"unknown option: {sys.argv[i]}"); return 2

    if use_stdin:
        samples = read_stdin_raw()
        print(f"stdin: {len(samples)} mono samples @ 16 kHz (raw S16_LE)")
    elif wav is not None:
        samples, _nch = read_wav16(wav)
        print(f"wav: {len(samples)} mono samples @ 16 kHz ({len(samples)//16000}s)")
    else:
        print("usage: wake-sdk-demo.py [input.wav|--stdin] [--threshold 0.5] "
              "[--min-duration 300] [--backend <id>] [--model-dir <dir>]")
        return 2

    sdk = SDK()
    caps = sdk.capabilities
    print(f"SDK v{sdk.version}: backends={caps.backend_count} "
          f"vad={bool(caps.have_vad)} threads={bool(caps.have_threads)} "
          f"float_dsp={bool(caps.have_float_dsp)}")
    print(f"backends: {sdk.backend_id_list()}")

    pipe = sdk.pipeline(backend, cfg, model_dir)
    print(f"pipeline: backend='{backend}'"
          + (f" model_dir='{model_dir}'" if model_dir else ""))
    triggered = False
    frame = [0] * 160
    pos = 0
    idx = 0
    while pos < len(samples):
        n = min(160, len(samples) - pos)
        frame[:n] = samples[pos:pos + n]
        out, ev = pipe.process(frame, idx * 10.0)
        if idx % 10 == 0:
            print(f"t={out.captured_at_ms:7.1f}ms "
                  f"score={out.raw_score:.3f} smooth={out.smoothed_score:.3f} "
                  f"vad={out.vad_probability:.3f}"
                  + ("  <--" if out.triggered else ""))
        if ev is not None:
            print(f"TRIGGER at {ev.triggered_at_ms:.1f} ms, "
                  f"peak {ev.peak_score:.3f}, word '{ev.word.decode()}'")
            triggered = True
        pos += n
        idx += 1

    pipe.close()
    sdk.close()
    return 0 if triggered else 1


if __name__ == "__main__":
    sys.exit(main())
