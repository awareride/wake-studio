"""wake_train_kit.generation — dataset generation pipeline (ADR-044 §5, #205).

One pipeline everywhere::

    collect -> synthesize -> postprocess -> assemble -> persist

TTS engines are pluggable adapters (ADR-033 self-registration): each engine
implements ``synthesize()`` and returns a provenance + label-role map, so the
same pipeline assembles a canonical ``wake-studio-dataset.zip`` regardless of
engine (classic edge-tts/piper, online HTTP TTS like mimo.mi.com, or LLM-TTS).

Engine contract (mirrors the web descriptors in
``packages/modules/data/dataset/spec/engines/*.json``):

- ``kind``: classic-tts | online-http-tts | llm-tts
- ``runtime``: browser + backend (online HTTP can run client-side in #208);
  this module is the BACKEND executor.
- ``synthesize(params, out_dir, reporter) -> dict`` with keys
  ``provenance`` (license-gate input) and ``labels`` (``[{name, role,
  language, source, voices}]``).
"""

from __future__ import annotations

import base64
import io
import json
import re
import shutil
import subprocess
import time
import uuid
import wave
from pathlib import Path
from typing import Any, Protocol

from .data_sources import DataSourceError, build_edge_tts_kws_dataset
from .dataset import pack_dataset_zip
from .postprocess import apply_postprocess

GEN_ENGINES = ("edge-tts", "piper", "mimo-http", "qwen-llm-tts")


class GenerationError(RuntimeError):
    """Raised when a dataset generation job cannot proceed."""


class TTSEngine(Protocol):
    id: str
    kind: str

    def synthesize(self, params: dict[str, Any], out_dir: Path, reporter: Any) -> dict[str, Any]:
        """Write a canonical ``label/*.wav`` tree into ``out_dir``.

        Returns ``{"provenance": {...}, "labels": [{name, role, ...}]}``.
        """


def _sanitize_label(text: str) -> str:
    cleaned = re.sub(r"[^0-9a-zA-Z_-]+", "_", text.strip().lower())
    return cleaned or "word"


# --- engine adapters ---------------------------------------------------------


class EdgeTTSEngine:
    """classic-tts: multi-language edge-tts synthesis (reuses data_sources)."""

    id = "edge-tts"
    kind = "classic-tts"

    def synthesize(self, params: dict[str, Any], out_dir: Path, reporter: Any) -> dict[str, Any]:
        phrases = _as_list(params.get("phrases", []))
        if not phrases:
            raise GenerationError("edge-tts requires at least one phrase")
        languages = _as_list(params.get("languages", ["en-US"]))
        unknown_words = _as_list(
            params.get("unknownWords", ["goodbye", "okay", "stop", "hello", "thanks"])
        )
        samples = int(params.get("samplesPerPhrase", 3) or 3)

        provenance = build_edge_tts_kws_dataset(
            phrases,
            languages,
            out_dir,
            samples_per_phrase=samples,
            unknown_words=unknown_words,
            reporter=reporter,
        )

        labels: list[dict[str, Any]] = []
        for phrase in phrases:
            labels.append(
                {
                    "name": _sanitize_label(phrase),
                    "role": "positive",
                    "language": languages[0] if languages else None,
                    "source": "synthetic",
                    "voices": None,
                }
            )
        for word in unknown_words:
            labels.append(
                {"name": _sanitize_label(word), "role": "unknown", "source": "synthetic"}
            )
        labels.append(
            {"name": "_background_noise_", "role": "noise", "source": "synthetic"}
        )
        return {"provenance": provenance, "labels": labels}


class PiperEngine:
    """classic-tts: piper-sample-generator (declared; adapter lands with the
    openwakeword training path)."""

    id = "piper"
    kind = "classic-tts"

    def synthesize(self, params: dict[str, Any], out_dir: Path, reporter: Any) -> dict[str, Any]:
        raise NotImplementedError(
            "piper TTS adapter is not implemented yet (#205); use edge-tts or "
            "an online HTTP TTS engine (e.g. mimo-http)"
        )


class OnlineHTTSEngine:
    """online-http-tts: any user-configured OpenAI-compatible TTS API + key.

    Generic enough for mimo.mi.com (chat.completions with the target text in an
    ``assistant`` message and the style/voice instruction in a ``user`` message)
    and for OpenAI-compatible LLM-TTS endpoints. The HTTP call is mockable via
    ``post_json`` so tests run without network.
    """

    id = "online-http-tts"
    kind = "online-http-tts"

    def __init__(self, *, post_json: Any = None) -> None:
        self._post_json = post_json

    # The request/response contract follows the MiMo speech-synthesis v2.5 doc
    # (OpenAI-compatible chat.completions; audio comes back base64 pcm16).
    def _request(self, params: dict[str, Any], text: str) -> bytes:
        endpoint = (params.get("endpoint") or "https://api.xiaomimimo.com/v1").rstrip("/")
        api_key = params.get("apiKey") or ""
        model = params.get("model") or "mimo-v2.5-tts"
        voice = params.get("voice") or ""
        style = params.get("styleInstruction") or ""
        output_format = (params.get("outputFormat") or "pcm16").lower()

        user_content = " ".join(p for p in (style, f"voice: {voice}" if voice else "") if p)
        messages = []
        if user_content:
            messages.append({"role": "user", "content": user_content})
        messages.append({"role": "assistant", "content": text})

        post = self._post_json or _http_post_json
        data = post(
            f"{endpoint}/chat/completions",
            headers={"Authorization": f"Bearer {api_key}"},
            payload={
                "model": model,
                "messages": messages,
                "audio": {"format": output_format},
            },
        )
        return _extract_audio(data, output_format)

    def synthesize(self, params: dict[str, Any], out_dir: Path, reporter: Any) -> dict[str, Any]:
        phrases = _as_list(params.get("phrases", []))
        if not phrases:
            raise GenerationError(f"{self.id} requires at least one phrase")
        languages = _as_list(params.get("languages", ["en-US"]))
        samples = int(params.get("samplesPerPhrase", 3) or 3)
        sample_rate = int(params.get("sampleRate", 16000) or 16000)

        total = 0
        for phrase in phrases:
            label = _sanitize_label(phrase)
            label_dir = out_dir / label
            label_dir.mkdir(parents=True, exist_ok=True)
            for i in range(samples):
                audio = self._request(params, phrase)
                wav = _to_canonical_wav(audio, label_dir / f"{languages[0]}_{i}.wav", sample_rate)
                total += 1
                if reporter is not None and hasattr(reporter, "progress"):
                    reporter.progress(step=total, total=None, message=f"{self.id} {label} clip {i + 1}")
                elif reporter is not None:
                    _emit_log(reporter, "info", f"{self.id} {label} clip {i + 1}")
        # silence clips keep augmentation happy (mirror edge-tts layout)
        bg = out_dir / "_background_noise_"
        bg.mkdir(parents=True, exist_ok=True)
        from .data_sources import write_silence_wav

        for i in range(3):
            write_silence_wav(bg / f"silence_{i}.wav", seconds=1.0, sample_rate=16000)

        labels = [
            {
                "name": _sanitize_label(phrase),
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


class MimoEngine(OnlineHTTSEngine):
    """online-http-tts: MiMo speech synthesis v2.5 (mimo.mi.com)."""

    id = "mimo-http"
    kind = "online-http-tts"


class LLMTTSEngine(OnlineHTTSEngine):
    """llm-tts: OpenAI-compatible LLM-TTS endpoint (qwen / vibe-voice / F5).

    Hosted OpenAI-compatible endpoints work through the shared HTTP machinery;
    local-GPU runtimes (vibe-voice / F5-TTS) are a follow-up. Backend-only by
    descriptor (runtime: backend)."""

    id = "qwen-llm-tts"
    kind = "llm-tts"


ENGINE_ADAPTERS: dict[str, TTSEngine] = {
    "edge-tts": EdgeTTSEngine(),
    "piper": PiperEngine(),
    "mimo-http": MimoEngine(),
    "qwen-llm-tts": LLMTTSEngine(),
}


# --- HTTP + audio helpers (mockable) ------------------------------------------


def _http_post_json(url: str, headers: dict[str, str], payload: dict[str, Any]) -> dict[str, Any]:
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


def _extract_audio(data: dict[str, Any], output_format: str) -> bytes:
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


def _pcm_to_wav(pcm: bytes, sample_rate: int, channels: int = 1) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(channels)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        w.writeframes(pcm)
    return buf.getvalue()


def _to_canonical_wav(audio: bytes, dst: Path, sample_rate: int) -> Path:
    """Normalize raw TTS output into a canonical 16 kHz mono PCM wav."""
    if audio.startswith(b"RIFF") and audio[8:12] == b"WAVE":
        # already a wav: resample via ffmpeg when it isn't canonical
        if sample_rate == 16000:
            dst.write_bytes(audio)
            return dst
        return _resample_wav(audio, dst)
    if sample_rate != 16000:
        return _resample_pcm(audio, sample_rate, dst)
    dst.write_bytes(_pcm_to_wav(audio, 16000))
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


# --- pipeline -----------------------------------------------------------------


def _as_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [v.strip() for v in re.split(r"[,;]", value) if v.strip()]
    if isinstance(value, (list, tuple)):
        return [str(v) for v in value]
    return []


def _emit_log(reporter: Any, level: str, message: str) -> None:
    if reporter is not None and hasattr(reporter, "emit"):
        reporter.emit("log", level=level, message=message)
    elif reporter is not None and hasattr(reporter, "log"):
        reporter.log(level=level, message=message)


def build_manifest(
    params: dict[str, Any],
    audio_root: Path,
    provenance: dict[str, Any],
    labels: list[dict[str, Any]],
) -> dict[str, Any]:
    """Assemble the ``dataset.json`` manifest for a generated dataset."""
    clips = 0
    for label_dir in audio_root.iterdir():
        if label_dir.is_dir():
            clips += len(list(label_dir.glob("*.wav")))

    phrases = _as_list(params.get("phrases", []))
    languages = _as_list(params.get("languages", ["en-US"]))
    name = params.get("name") or (f"{_sanitize_label(phrases[0])}-{' '.join(languages)}" if phrases else "generated")
    dataset_id = params.get("datasetId") or str(uuid.uuid4())

    return {
        "schemaVersion": 1,
        "id": dataset_id,
        "name": name,
        "version": 1,
        "kind": "generated",
        "role": "mixed",
        "audio": {
            "sampleRate": 16000,
            "channels": 1,
            "encoding": "pcm_s16le",
            "clips": clips,
            "durationSec": 0,
        },
        "labels": labels,
        "provenance": [provenance],
        "recipe": {
            "engine": params.get("engine") or "edge-tts",
            "phrases": phrases,
            "languages": languages,
            "seed": 0,
            "toolVersions": {},
        },
        "storage": {"backend": f"datasets/{dataset_id}/"},
        "createdAtMs": int(time.time() * 1000),
    }


def generate_dataset(
    params: dict[str, Any],
    work_dir: Path | str,
    reporter: Any = None,
) -> Path:
    """Run the generation pipeline -> canonical ``wake-studio-dataset.zip``.

    Stages (emitted as NDJSON progress): synthesize -> postprocess -> assemble.
    The returned zip is the artifact the job manager registers (GET /artifacts).
    """
    work = Path(work_dir)
    audio_root = work / "audio"
    audio_root.mkdir(parents=True, exist_ok=True)

    engine_id = params.get("engine") or "edge-tts"
    engine = ENGINE_ADAPTERS.get(engine_id)
    if engine is None:
        raise GenerationError(
            f"unknown TTS engine '{engine_id}' (known: {', '.join(GEN_ENGINES)})"
        )

    _emit_log(reporter, "info", f"dataset-generate: engine={engine_id}")
    if reporter is not None and hasattr(reporter, "progress"):
        reporter.progress(step=1, total=3, progress=1 / 3, message="synthesize")

    result = engine.synthesize(params, audio_root, reporter)
    provenance = result["provenance"]
    labels = result["labels"]

    if reporter is not None and hasattr(reporter, "progress"):
        reporter.progress(step=2, total=3, progress=2 / 3, message="postprocess")
    apply_postprocess(params.get("postprocess") or "passthrough", audio_root, reporter)

    if reporter is not None and hasattr(reporter, "progress"):
        reporter.progress(step=3, total=3, progress=1.0, message="assemble")
    manifest = build_manifest(params, audio_root, provenance, labels)
    zip_path = pack_dataset_zip(audio_root, manifest, work / "wake-studio-dataset.zip")
    return zip_path
