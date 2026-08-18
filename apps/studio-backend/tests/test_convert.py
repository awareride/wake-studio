"""Tests for wake_train_kit.convert (ADR-039 §4.6).

The heavy toolchains (tf2onnx, onnxruntime) are exercised with fakes; the
tests cover the orchestration, error paths, and file handling. Real conversion
runs in the CI convert stage / the module convert env.
"""

import sys
from pathlib import Path

import pytest

from wake_train_kit.convert import (
    ConvertError,
    tflite_to_onnx,
    onnx_fp16,
    snapshot_calibration,
)

WAV44 = (
    b"RIFF" + b"\x24\x00\x00\x00" + b"WAVE"
    + b"fmt " + b"\x10\x00\x00\x00\x01\x00\x01\x00"
    + b"\x80\x3e\x00\x00\x00\x7d\x00\x00\x00\x02\x00\x10\x00"
    + b"data" + b"\x00\x00\x00\x00"
)


# --- tflite_to_onnx ---------------------------------------------------------


def test_tflite_to_onnx_calls_tf2onnx(tmp_path, monkeypatch):
    tflite = tmp_path / "model.tflite"
    tflite.write_bytes(b"tflite")
    out = tmp_path / "model.onnx"

    class R:
        returncode = 0
        stdout = ""
        stderr = ""

    def fake_run(cmd, capture_output=True, text=True, timeout=900):
        assert cmd[0] == sys.executable
        assert "-m" in cmd
        assert "tf2onnx.convert" in cmd
        assert "--tflite" in cmd
        assert str(tflite) in cmd
        assert str(out) in cmd
        assert "--dequantize" in cmd
        Path(str(out)).write_bytes(b"fake-onnx")
        return R()

    monkeypatch.setattr("wake_train_kit.convert.subprocess.run", fake_run)
    result = tflite_to_onnx(tflite, out)
    assert result == out
    assert out.read_bytes() == b"fake-onnx"


def test_tflite_to_onnx_missing_input(tmp_path):
    with pytest.raises(ConvertError, match="tflite not found"):
        tflite_to_onnx(tmp_path / "nope.tflite", tmp_path / "out.onnx")


def test_tflite_to_onnx_propagates_tf2onnx_failure(tmp_path, monkeypatch):
    tflite = tmp_path / "model.tflite"
    tflite.write_bytes(b"tflite")

    class R:
        returncode = 1
        stdout = ""
        stderr = "boom"

    monkeypatch.setattr(
        "wake_train_kit.convert.subprocess.run", lambda *a, **k: R()
    )
    with pytest.raises(ConvertError, match="tf2onnx failed"):
        tflite_to_onnx(tflite, tmp_path / "out.onnx")


# --- onnx_fp16 --------------------------------------------------------------


def test_onnx_fp16_uses_onnxruntime(tmp_path, monkeypatch):
    onnx = tmp_path / "model.onnx"
    onnx.write_bytes(b"onnx")
    out = tmp_path / "model-fp16.onnx"

    calls: list[dict] = []

    def quantize_dynamic(model_input, model_output, weight_type):  # noqa: D102
        calls.append({"input": model_input, "output": model_output, "weight_type": weight_type})
        Path(model_output).write_bytes(b"fp16-onnx")

    quant_mod = type("quantization", (), {"quantize_dynamic": staticmethod(quantize_dynamic)})
    onnx_mod = type("onnxruntime", (), {"quantization": quant_mod})
    monkeypatch.setitem(sys.modules, "onnxruntime", onnx_mod)
    monkeypatch.setitem(sys.modules, "onnxruntime.quantization", quant_mod)

    result = onnx_fp16(onnx, out)
    assert result == out
    assert calls[0]["weight_type"] == "FLOAT16"
    assert Path(calls[0]["output"]).read_bytes() == b"fp16-onnx"


def test_onnx_fp16_missing_onnxruntime(tmp_path, monkeypatch):
    onnx = tmp_path / "model.onnx"
    onnx.write_bytes(b"onnx")
    real_import = __import__

    def fake_import(mod, *a, **k):
        if mod.startswith("onnxruntime"):
            raise ImportError(mod)
        return real_import(mod, *a, **k)

    monkeypatch.setattr("builtins.__import__", fake_import)
    with pytest.raises(ConvertError, match="onnxruntime is not installed"):
        onnx_fp16(onnx, tmp_path / "out.onnx")


def test_snapshot_calibration_copies_up_to_budget(tmp_path):
    # two wavs: one 1s (byte_rate 8000 -> data_size 8000), one 2s
    one_s = WAV44[:28] + (8000).to_bytes(4, "little") + WAV44[32:40] + (8000).to_bytes(4, "little")
    two_s = WAV44[:28] + (8000).to_bytes(4, "little") + WAV44[32:40] + (16000).to_bytes(4, "little")
    a = tmp_path / "a.wav"
    b = tmp_path / "b.wav"
    a.write_bytes(one_s)
    b.write_bytes(two_s)
    out = tmp_path / "cal"

    copied = snapshot_calibration([a, b], out, max_seconds=2.5, sample_rate=8000)
    assert len(copied) >= 1
    assert (out / "a.wav").is_file()


def test_snapshot_calibration_skips_invalid(tmp_path):
    bad = tmp_path / "bad.wav"
    bad.write_bytes(b"not a wav")
    good = tmp_path / "good.wav"
    good.write_bytes(WAV44[:28] + (8000).to_bytes(4, "little") + WAV44[32:40] + (8000).to_bytes(4, "little"))
    out = tmp_path / "cal"
    copied = snapshot_calibration([bad, good], out, max_seconds=5, sample_rate=8000)
    assert copied == [out / "good.wav"]
