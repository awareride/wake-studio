#!/usr/bin/env python3
"""wake-sdk-demo.py — Python demo for the device-side SDK (issue #187).

Streams a 16 kHz mono PCM16 WAV through the ctypes binding and prints score
samples + triggers. Exit code 0 when triggered, 1 otherwise (CI smoke).

Usage: python3 wake-sdk-demo.py <input.wav> [--threshold 0.5] [--min-duration 300]
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


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: wake-sdk-demo.py <input.wav> [--threshold 0.5] "
              "[--min-duration 300]")
        return 2

    cfg: dict = {}
    i = 2
    while i < len(sys.argv):
        if sys.argv[i] == "--threshold" and i + 1 < len(sys.argv):
            cfg["threshold"] = float(sys.argv[i + 1]); i += 2
        elif sys.argv[i] == "--min-duration" and i + 1 < len(sys.argv):
            cfg["min_duration_ms"] = int(sys.argv[i + 1]); i += 2
        else:
            print(f"unknown option: {sys.argv[i]}"); return 2

    samples, nch = read_wav16(sys.argv[1])
    print(f"wav: {len(samples)} mono samples @ 16 kHz ({len(samples)//16000}s)")

    sdk = SDK()
    caps = sdk.capabilities
    print(f"SDK v{sdk.version}: backends={caps.backend_count} "
          f"vad={bool(caps.have_vad)} threads={bool(caps.have_threads)} "
          f"float_dsp={bool(caps.have_float_dsp)}")

    pipe = sdk.pipeline("rms", cfg)
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
