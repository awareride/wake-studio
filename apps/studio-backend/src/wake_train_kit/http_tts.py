"""wake_train_kit.http_tts — shared online/LLM TTS HTTP machinery (ADR-044 §5, #205).

Reused by the `online-http-tts` (mimo-tts) and `llm-tts` (qwen-llm-tts) engine
adapters. The request/response contract follows the MiMo speech-synthesis v2.5
doc (OpenAI-compatible chat.completions: target text in an ``assistant``
message, style/voice instruction in a ``user`` message; audio comes back
base64 pcm16). ``post_json`` is injectable so adapters are testable without
network.
"""

from __future__ import annotations

import base64
import io
import json
import shutil
import subprocess
import wave
from pathlib import Path
from typing import Any, Callable

from .data_sources import write_silence_wav


class GenerationError(RuntimeError):
    """Raised when an online/LLM TTS engine cannot produce audio."""


def http_post_json(url: str, headers: dict[str, str], payload: dict[str, Any]) -> dict[str, Any]:
    """Minimal JSON POST (urllib, no deps). Returns the parsed JSON response."""
    import urllib.request

    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", **headers},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as resp:  # noqa: S310 (user-configured URL)
        raw = resp.read()
    try:
        return json.loads(raw)
    except (ValueError, UnicodeDecodeError):
        return {"audio": base64.b64encode(raw).decode("ascii")}


def extract_audio(data: dict[str, Any], output_format: str) -> bytes:
    """Pull audio bytes out of a chat.completions-style response."""
    if isinstance(data, bytes):
        return data
    if not isinstance(data, dict):
        raise GenerationError(f"TTS response was not JSON: {type(data).__name__}")
    # direct base64 audio field
    audio = data.get("audio")
    if isinstance(audio, str):
        return base64.b64decode(audio)
    if isinstance(audio, dict) and isinstance(audio.get("data"), str):
        return base64.b64decode(audio["data"])
    # OpenAI chat-completions shape
    try:
        content = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise GenerationError(f"TTS response missing audio: {json.dumps(data)[:200]}") from exc
    if isinstance(content, str) and content:
        return base64.b64decode(content)
    if isinstance(content, dict):
        audio = content.get("audio") or content.get("data")
        if isinstance(audio, str):
            return base64.b64decode(audio)
    raise GenerationError(f"TTS response has no parseable audio: {json.dumps(data)[:200]}")


def pcm_to_wav(pcm: bytes, sample_rate: int, channels: int = 1) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(channels)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        w.writeframes(pcm)
    return buf.getvalue()


def to_canonical_wav(audio: bytes, dst: Path, sample_rate: int) -> Path:
    """Normalize raw TTS output into a canonical 16 kHz mono PCM wav."""
    if audio.startswith(b"RIFF") and audio[8:12] == b"WAVE":
        if sample_rate == 16000:
            dst.write_bytes(audio)
            return dst
        return _resample_wav(audio, dst)
    if sample_rate != 16000:
        return _resample_pcm(audio, sample_rate, dst)
    dst.write_bytes(pcm_to_wav(audio, 16000))
    return dst


def _resample_pcm(pcm: bytes, sample_rate: int, dst: Path) -> Path:
    if not shutil.which("ffmpeg"):
        raise GenerationError(
            f"TTS returned pcm16 at {sample_rate} Hz; converting to the canonical "
            "16 kHz needs ffmpeg (install it or configure a 16 kHz endpoint)"
        )
    tmp = dst.with_suffix(".pcm")
    tmp.write_bytes(pcm)
    subprocess.run(
        ["ffmpeg", "-y", "-f", "s16le", "-ar", str(sample_rate), "-ac", "1",
         "-i", str(tmp), "-ar", "16000", "-ac", "1", str(dst)],
        check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    tmp.unlink(missing_ok=True)
    return dst


def _resample_wav(wav: bytes, dst: Path) -> Path:
    if not shutil.which("ffmpeg"):
        raise GenerationError("converting a non-16k wav to the canonical 16 kHz needs ffmpeg")
    tmp = dst.with_suffix(".src.wav")
    tmp.write_bytes(wav)
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(tmp), "-ar", "16000", "-ac", "1", str(dst)],
        check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    tmp.unlink(missing_ok=True)
    return dst


class OnlineHTTPEngineBase:
    """Base for OpenAI-compatible online/LLM TTS engines (ADR-044 §5.1).

    Subclasses set ``id`` / ``kind`` and optionally ``default_model``. The
    HTTP call is mockable via ``post_json`` so tests run without network.
    """

    id = "online-http-tts"
    kind = "online-http-tts"
    default_model = ""

    def __init__(self, *, post_json: Callable[..., dict[str, Any]] | None = None) -> None:
        self._post_json = post_json

    def _request(self, params: dict[str, Any], text: str) -> bytes:
        endpoint = (params.get("endpoint") or "https://api.xiaomimimo.com/v1").rstrip("/")
        api_key = params.get("apiKey") or ""
        model = params.get("model") or self.default_model or "mimo-v2.5-tts"
        voice = params.get("voice") or ""
        style = params.get("styleInstruction") or ""
        output_format = (params.get("outputFormat") or "pcm16").lower()

        user_content = " ".join(p for p in (style, f"voice: {voice}" if voice else "") if p)
        messages = []
        if user_content:
            messages.append({"role": "user", "content": user_content})
        messages.append({"role": "assistant", "content": text})

        post = self._post_json or http_post_json
        data = post(
            f"{endpoint}/chat/completions",
            headers={"Authorization": f"Bearer {api_key}"},
            payload={
                "model": model,
                "messages": messages,
                "audio": {"format": output_format},
            },
        )
        return extract_audio(data, output_format)

    def synthesize(self, params: dict[str, Any], out_dir: Path, reporter: Any) -> dict[str, Any]:
        phrases = as_list(params.get("phrases", []))
        if not phrases:
            raise GenerationError(f"{self.id} requires at least one phrase")
        languages = as_list(params.get("languages", ["en-US"]))
        samples = int(params.get("samplesPerPhrase", 3) or 3)
        sample_rate = int(params.get("sampleRate", 16000) or 16000)

        total = 0
        for phrase in phrases:
            label = sanitize_label(phrase)
            label_dir = out_dir / label
            label_dir.mkdir(parents=True, exist_ok=True)
            for i in range(samples):
                audio = self._request(params, phrase)
                to_canonical_wav(audio, label_dir / f"{languages[0]}_{i}.wav", sample_rate)
                total += 1
                if reporter is not None and hasattr(reporter, "progress"):
                    reporter.progress(step=total, total=None, message=f"{self.id} {label} clip {i + 1}")
                elif reporter is not None and hasattr(reporter, "emit"):
                    reporter.emit("log", level="info", message=f"{self.id} {label} clip {i + 1}")

        # silence clips keep augmentation happy (mirror edge-tts layout)
        bg = out_dir / "_background_noise_"
        bg.mkdir(parents=True, exist_ok=True)
        for i in range(3):
            write_silence_wav(bg / f"silence_{i}.wav", seconds=1.0, sample_rate=16000)

        labels = [
            {
                "name": sanitize_label(phrase),
                "role": "positive",
                "language": languages[0] if languages else None,
                "source": "synthetic",
            }
            for phrase in phrases
        ] + [{"name": "_background_noise_", "role": "noise", "source": "synthetic"}]
        provenance = {
            "name": f"{self.id} synthetic speech (online API)",
            "license": "user-owned (synthetic TTS)",
            "source": params.get("endpoint") or "user-configured online TTS",
            "commercialUse": True,
            "clips": total,
        }
        return {"provenance": provenance, "labels": labels}


def sanitize_label(text: str) -> str:
    import re

    cleaned = re.sub(r"[^0-9a-zA-Z_-]+", "_", text.strip().lower())
    return cleaned or "word"


def as_list(value: Any) -> list[str]:
    import re

    if value is None:
        return []
    if isinstance(value, str):
        return [v.strip() for v in re.split(r"[,;]", value) if v.strip()]
    if isinstance(value, (list, tuple)):
        return [str(v) for v in value]
    return []
