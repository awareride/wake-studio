"""Data-source layer (ADR-022): audio for wake-word training.

Training-time only — nothing here runs in the browser. Module train adapters
call these helpers to prepare a `label/*.wav` tree for the upstream training
script, from one of three pluggable sources:

- ``speech-commands-v2`` — the public Google Speech Commands V2 dataset
  (CC BY 4.0, commercially usable with attribution), downloaded + extracted.
- ``user-url`` — a user-provided archive URL (``.tar.gz`` / ``.tgz`` /
  ``.tar`` / ``.zip``) pointing at their own `label/*.wav` tree.
- ``edge-tts`` — multi-language TTS synthesis via Microsoft Edge TTS
  (``edge-tts``): wake-word positives + "unknown" negatives, arranged into a
  label tree the kws_streaming trainer can consume.

Every helper returns a ``provenance`` dict so the adapter can record the data
source in ``provenance.json`` (the Phase 4 license-gate input).
"""

from __future__ import annotations

import shutil
import subprocess
import tarfile
import time
import urllib.request
import wave
import zipfile
from pathlib import Path
from typing import Any

SPEECH_COMMANDS_V2_URL = (
    "https://storage.googleapis.com/download.tensorflow.org/data/"
    "speech_commands_v0.02.tar.gz"
)

#: A small multi-language voice map so wake phrases can be synthesized in more
#: than one language out of the box. Overridable by the caller.
EDGE_TTS_VOICES: dict[str, list[str]] = {
    "en-US": ["en-US-AriaNeural", "en-US-GuyNeural", "en-US-JennyNeural"],
    "en-GB": ["en-GB-SoniaNeural", "en-GB-RyanNeural"],
    "zh-CN": ["zh-CN-XiaoxiaoNeural", "zh-CN-YunxiNeural"],
    "ja-JP": ["ja-JP-NanamiNeural", "ja-JP-KeitaNeural"],
    "es-ES": ["es-ES-ElviraNeural", "es-ES-AlvaroNeural"],
    "de-DE": ["de-DE-KatjaNeural", "de-DE-ConradNeural"],
    "fr-FR": ["fr-FR-DeniseNeural", "fr-FR-HenriNeural"],
    "ko-KR": ["ko-KR-SunHiNeural", "ko-KR-InJoonNeural"],
}

#: Default "unknown" negatives synthesized alongside the wake phrase so the
#: classifier has an _unknown_ class to reject.
DEFAULT_UNKNOWN_WORDS = ["stop", "go", "up", "down", "on", "off", "left", "right"]

_CHUNK = 1024 * 1024


class DataSourceError(RuntimeError):
    pass


def _log(reporter: Any, level: str, message: str) -> None:
    if reporter is None:
        return
    log = getattr(reporter, "log", None)
    if callable(log):
        log(level=level, message=message)
    else:
        emit = getattr(reporter, "emit", None)
        if callable(emit):
            emit("log", level=level, message=message)


def _heartbeat(reporter: Any) -> None:
    if reporter is None:
        return
    hb = getattr(reporter, "heartbeat", None)
    if callable(hb):
        hb()


def download_file(url: str, dest: Path, reporter: Any = None) -> Path:
    """Stream ``url`` to ``dest`` with progress heartbeats (stdlib only)."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    _log(reporter, "info", f"downloading {url}")
    req = urllib.request.Request(url, headers={"User-Agent": "wake-studio"})
    last = time.monotonic()
    with urllib.request.urlopen(req, timeout=60) as resp, open(dest, "wb") as out:
        while True:
            chunk = resp.read(_CHUNK)
            if not chunk:
                break
            out.write(chunk)
            if time.monotonic() - last > 30:
                _heartbeat(reporter)
                last = time.monotonic()
    _log(reporter, "info", f"downloaded {dest} ({dest.stat().st_size} bytes)")
    return dest


def extract_archive(path: Path, dest: Path) -> Path:
    """Extract ``.tar.gz``/``.tgz``/``.tar``/``.zip`` into ``dest``."""
    dest.mkdir(parents=True, exist_ok=True)
    name = path.name.lower()
    if name.endswith((".tar.gz", ".tgz", ".tar")):
        with tarfile.open(path) as tf:
            tf.extractall(dest)
    elif name.endswith(".zip"):
        with zipfile.ZipFile(path) as zf:
            zf.extractall(dest)
    else:
        raise DataSourceError(
            f"unsupported archive type for {path.name}; expected .tar.gz/.tgz/.tar/.zip"
        )
    return dest


def _looks_like_wav_dir(p: Path) -> bool:
    if not p.is_dir():
        return False
    if (p / "_background_noise_").is_dir():
        return True
    # a data root is a dir whose immediate children are label folders
    # containing wav files (not a deep recursive ancestor)
    for child in p.iterdir():
        if child.is_dir() and (any(child.glob("*.wav")) or any(child.glob("*.WAV"))):
            return True
    return False


def find_data_root(dest: Path) -> Path:
    """Find the real `label/*.wav` root after extraction.

    Archives wrap the dataset in a variable top-level directory
    (Speech Commands V2 extracts to ``SpeechCommands/speech_commands_v0.02``);
    this walks down to the first dir that contains ``_background_noise_`` or
    any ``.wav`` files.
    """
    if _looks_like_wav_dir(dest):
        return dest
    candidates = sorted(p for p in dest.rglob("*") if _looks_like_wav_dir(p))
    if candidates:
        return candidates[0]
    raise DataSourceError(f"no wav dataset found under {dest}")


def prepare_speech_commands_v2(
    data_dir: Path, reporter: Any = None
) -> tuple[Path, dict[str, Any]]:
    """Download + extract Speech Commands V2 (CC BY 4.0) and return its root."""
    data_dir = Path(data_dir)
    archive = data_dir / "_download" / "speech_commands_v0.02.tar.gz"
    download_file(SPEECH_COMMANDS_V2_URL, archive, reporter)
    extract_archive(archive, data_dir)
    root = find_data_root(data_dir)
    provenance = {
        "name": "Google Speech Commands V2 (speech_commands_v0.02)",
        "license": "CC BY 4.0 (attribution required)",
        "source": SPEECH_COMMANDS_V2_URL,
        "commercialUse": True,
    }
    return root, provenance


def prepare_user_archive(
    url: str, data_dir: Path, reporter: Any = None
) -> tuple[Path, dict[str, Any]]:
    """Download + extract a user-provided dataset archive and return its root."""
    if not url:
        raise DataSourceError("data source 'user-url' requires dataUrl")
    data_dir = Path(data_dir)
    suffix = ".tar.gz"
    for ext in (".tar.gz", ".tgz", ".tar", ".zip"):
        if url.lower().rsplit("?", 1)[0].endswith(ext):
            suffix = ext
            break
    archive = data_dir / "_download" / f"user_dataset{suffix}"
    download_file(url, archive, reporter)
    extract_archive(archive, data_dir)
    root = find_data_root(data_dir)
    provenance = {
        "name": "user-provided dataset",
        "license": "user-provided (verify before commercial deployment)",
        "source": url,
        "commercialUse": False,  # conservative; the license gate treats this as unknown
    }
    return root, provenance


def _sanitize_label(text: str) -> str:
    label = "_".join(text.strip().lower().split())
    return label or "word"


def synthesize(
    text: str,
    voice: str,
    mp3_path: Path,
    rate: str = "+0%",
    pitch: str = "+0Hz",
    volume: str = "+0%",
) -> Path:
    """Synthesize one clip with edge-tts (lazy import; mp3 output)."""
    try:
        import edge_tts  # type: ignore
    except ImportError as exc:  # pragma: no cover - depends on the extra
        raise DataSourceError(
            "edge-tts is not installed; add the studio-backend 'tts' extra "
            "(`uv sync --extra tts` or `pip install edge-tts`)"
        ) from exc
    mp3_path.parent.mkdir(parents=True, exist_ok=True)
    communicate = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch, volume=volume)
    communicate.save(str(mp3_path))  # type: ignore[attr-defined]
    return mp3_path


def mp3_to_wav(mp3_path: Path, wav_path: Path, sample_rate: int = 16000) -> Path:
    """Convert an mp3 clip to 16-bit mono WAV via ffmpeg (16 kHz)."""
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise DataSourceError(
            "edge-tts outputs mp3; ffmpeg is required to convert to 16 kHz WAV "
            "(install ffmpeg on the training backend)"
        )
    wav_path.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            ffmpeg,
            "-y",
            "-loglevel", "error",
            "-i", str(mp3_path),
            "-ar", str(sample_rate),
            "-ac", "1",
            "-sample_fmt", "s16",
            str(wav_path),
        ],
        check=True,
    )
    return wav_path


def write_silence_wav(path: Path, seconds: float = 1.0, sample_rate: int = 16000) -> Path:
    """Write a silent 16-bit mono WAV (used as a `_background_noise_` clip)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    frames = b"\x00\x00" * int(seconds * sample_rate)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        w.writeframes(frames)
    return path


#: Pitch/rate/volume variations so a repeated phrase is not byte-identical.
_TTS_VARIATIONS = [
    ("+0%", "+0Hz", "+0%"),
    ("+4%", "+2Hz", "+0%"),
    ("-4%", "-2Hz", "+0%"),
    ("+8%", "+0Hz", "-10%"),
    ("-8%", "+0Hz", "+10%"),
]


def build_edge_tts_kws_dataset(
    phrases: list[str],
    languages: list[str],
    out_dir: Path,
    samples_per_phrase: int = 3,
    unknown_words: list[str] | None = None,
    sample_rate: int = 16000,
    voices: dict[str, list[str]] | None = None,
    reporter: Any = None,
) -> dict[str, Any]:
    """Build a multi-language `label/*.wav` tree for kws_streaming.

    Wake phrases become positive folders (folder name = sanitized phrase);
    ``unknown_words`` become the "unknown" negatives (their folders are not in
    ``--wanted_words``, so upstream folds them into ``_unknown_``); a few
    silence clips are written to ``_background_noise_``.
    """
    try:
        import edge_tts  # noqa: F401  (fail fast with a clear error)
    except ImportError as exc:  # pragma: no cover
        raise DataSourceError(
            "edge-tts is not installed; add the studio-backend 'tts' extra"
        ) from exc

    out_dir = Path(out_dir)
    voices = voices or EDGE_TTS_VOICES
    unknown_words = unknown_words if unknown_words is not None else DEFAULT_UNKNOWN_WORDS
    languages = [l for l in languages if l]
    if not languages:
        raise DataSourceError("edge-tts source requires at least one language")

    positive_labels: list[str] = []
    total = 0

    # positives: the wake phrase(s)
    for phrase in phrases:
        if not phrase.strip():
            continue
        label = _sanitize_label(phrase)
        positive_labels.append(label)
        label_dir = out_dir / label
        for lang in languages:
            lang_voices = voices.get(lang, voices.get("en-US", []))
            if not lang_voices:
                continue
            for i in range(max(1, samples_per_phrase)):
                voice = lang_voices[i % len(lang_voices)]
                rate, pitch, volume = _TTS_VARIATIONS[i % len(_TTS_VARIATIONS)]
                mp3 = label_dir / f"{lang}_{i}.mp3"
                synthesize(phrase, voice, mp3, rate=rate, pitch=pitch, volume=volume)
                mp3_to_wav(mp3, label_dir / f"{lang}_{i}.wav", sample_rate)
                mp3.unlink(missing_ok=True)
                total += 1
                if reporter is not None and hasattr(reporter, "progress"):
                    reporter.progress(
                        step=total, total=None, message=f"tts {label}/{lang} clip {i + 1}"
                    )
                else:
                    _log(reporter, "info", f"tts {label}/{lang} clip {i + 1}")

    # negatives: unknown words (one clip each per language, first voice only)
    for word in unknown_words:
        label = _sanitize_label(word)
        label_dir = out_dir / label
        for lang in languages:
            lang_voices = voices.get(lang, voices.get("en-US", []))
            if not lang_voices:
                continue
            mp3 = label_dir / f"{lang}_0.mp3"
            synthesize(word, lang_voices[0], mp3)
            mp3_to_wav(mp3, label_dir / f"{lang}_0.wav", sample_rate)
            mp3.unlink(missing_ok=True)
            total += 1
            _log(reporter, "info", f"tts negative {label}/{lang}")

    # background noise: a couple of silent clips keep augmentation happy
    bg = out_dir / "_background_noise_"
    for i in range(3):
        write_silence_wav(bg / f"silence_{i}.wav", seconds=1.0, sample_rate=sample_rate)

    provenance = {
        "name": "edge-tts synthetic speech (multi-language)",
        "license": "user-owned (synthetic TTS)",
        "source": "https://github.com/rany2/edge-tts",
        "commercialUse": True,
        "languages": languages,
        "phrases": phrases,
        "clips": total,
    }
    return provenance
