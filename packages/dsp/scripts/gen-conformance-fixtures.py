#!/usr/bin/env python3
"""
Generate DSP conformance fixtures for @wake-studio/dsp (ADR-032).

The JS package's correctness contract is anchored on these files: the
conformance tests (tests/conformance) diff the TS implementation against
these Python-computed reference values. Regenerate with:

    python3 scripts/gen-conformance-fixtures.py   (or the pnpm script)

Dependencies (see packages/dsp/README.md): numpy + scipy (fixtures), and the
resulting .json files are committed to tests/fixtures/ so the JS tests need no
Python at run time.
"""

import json
import math
import os

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "tests", "fixtures")
os.makedirs(OUT, exist_ok=True)


def gen_fft_fixture():
    """FFT reference values from scipy.fft.fft for several sizes and signals."""
    sizes = [8, 16, 256, 1024]
    cases = []
    for n in sizes:
        # DC impulse, alternating (Nyquist), and a mixed-sine signal
        signals = {
            "impulse": np.array([1.0] + [0.0] * (n - 1), dtype=np.float64),
            "nyquist": np.array([1.0 if i % 2 == 0 else -1.0 for i in range(n)], dtype=np.float64),
            "mixed": (
                np.sin(2 * np.pi * 3 * np.arange(n) / n) * 0.7
                + np.sin(2 * np.pi * 17 * np.arange(n) / n) * 0.3
            ).astype(np.float64),
        }
        for name, sig in signals.items():
            spec = np.fft.fft(sig)
            cases.append(
                {
                    "size": n,
                    "name": name,
                    "real": sig.tolist(),
                    "expected_real": np.real(spec).tolist(),
                    "expected_imag": np.imag(spec).tolist(),
                }
            )
    with open(os.path.join(OUT, "fft.json"), "w") as f:
        json.dump({"cases": cases}, f)
    print(f"  fft.json ({len(cases)} cases)")


def gen_stft_fixture():
    """STFT magnitude from scipy.signal.stft (no padding, exact framing)."""
    from scipy import signal

    rng = np.random.default_rng(42)
    nfft = 256
    hop = 64
    x = rng.standard_normal(1024).astype(np.float64)
    f, t, Zxx = signal.stft(
        x, fs=16000, window="hann", nperseg=nfft, noverlap=nfft - hop,
        boundary=None, padded=False,
    )
    # scipy magnitude is the true |Z|; our magnitude mode returns |Z| too.
    cases = [
        {
            "nfft": nfft,
            "hop": hop,
            "frames": Zxx.shape[1],
            "signal": x.tolist(),
            "mag": np.abs(Zxx).astype(np.float32).tolist(),
        }
    ]
    with open(os.path.join(OUT, "stft.json"), "w") as f:
        json.dump({"cases": cases}, f)
    print(f"  stft.json ({len(cases)} case, frames={Zxx.shape[1]})")


def gen_mel_fixture():
    """Mel filterbank + mel spectrogram from the PLiX front-end math.

    Reference: plixkws/backbone.py::Backbone's MelSpectrogram config
    (sample_rate=16000, f_min=60, f_max=7800, n_mels=64, win_length=400,
    hop_length=160, n_fft=1024) with raw magnitude (no log).
    """
    sr = 16000
    n_mels = 64
    f_min = 60.0
    f_max = 7800.0
    n_fft = 1024
    win_len = 400
    hop = 160

    num_fft = n_fft // 2 + 1

    def hz_to_mel(hz):
        return 2595 * math.log10(1 + hz / 700)

    def mel_to_hz(mel):
        return 700 * (10 ** (mel / 2595) - 1)

    # Slaney triangular filterbank, laid out [melBin, fftBin] (matches TS).
    hz_points = [
        mel_to_hz(hz_to_mel(f_min) + (i / (n_mels + 1)) * (hz_to_mel(f_max) - hz_to_mel(f_min)))
        for i in range(n_mels + 2)
    ]
    fb = np.zeros((n_mels, num_fft), dtype=np.float64)
    for m in range(1, n_mels + 1):
        f_left, f_center, f_right = hz_points[m - 1], hz_points[m], hz_points[m + 1]
        k_left = int(np.floor((f_left / (sr / 2)) * (num_fft - 1)))
        k_center = int(np.floor((f_center / (sr / 2)) * (num_fft - 1)))
        k_right = int(np.floor((f_right / (sr / 2)) * (num_fft - 1)))
        for k in range(k_left, k_center):
            if 0 <= k < num_fft:
                fb[m - 1, k] = (k - k_left) / max(1, k_center - k_left)
        for k in range(k_center, k_right):
            if 0 <= k < num_fft:
                fb[m - 1, k] = (k_right - k) / max(1, k_right - k_center)

    # A deterministic 1-second-ish signal
    rng = np.random.default_rng(7)
    x = rng.standard_normal(16000).astype(np.float64)
    win = 0.5 * (1 - np.cos(2 * np.pi * np.arange(win_len) / win_len))
    frames = (len(x) - win_len) // hop + 1
    mel = np.zeros((n_mels, frames), dtype=np.float64)
    for f in range(frames):
        frame = x[f * hop : f * hop + n_fft] * 0
        frame[:win_len] = x[f * hop : f * hop + win_len] * win
        spec = np.fft.rfft(frame, n=n_fft)
        mag = np.abs(spec)
        for m in range(n_mels):
            mel[m, f] = np.dot(fb[m], mag)

    cases = [
        {
            "sampleRate": sr,
            "nMel": n_mels,
            "fMin": f_min,
            "fMax": f_max,
            "nFft": n_fft,
            "winLen": win_len,
            "hop": hop,
            "frames": frames,
            "signal": x.tolist(),
            "fb": fb.astype(np.float32).tolist(),
            "mel": mel.astype(np.float32).tolist(),
        }
    ]
    with open(os.path.join(OUT, "mel.json"), "w") as f:
        json.dump({"cases": cases}, f)
    print(f"  mel.json ({len(cases)} case, frames={frames})")


def main():
    print("Generating conformance fixtures in tests/fixtures/:")
    gen_fft_fixture()
    gen_stft_fixture()
    gen_mel_fixture()


if __name__ == "__main__":
    main()
