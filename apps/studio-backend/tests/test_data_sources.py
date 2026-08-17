"""wake_train_kit.data_sources tests (ADR-022, #152).

No network / no GPU: archive download is exercised through ``file://`` URLs,
and edge-tts is monkeypatched so the dataset layout + provenance are checked
without calling Microsoft's endpoint.
"""

import shutil
import sys
import tarfile
import wave
from pathlib import Path

from wake_train_kit import data_sources as ds


def _make_archive(root: Path, archive: Path, arcname: str) -> Path:
    (root / "yes").mkdir(parents=True, exist_ok=True)
    (root / "yes" / "a.wav").write_bytes(b"RIFFxxxx")
    (root / "_background_noise_").mkdir(exist_ok=True)
    (root / "_background_noise_" / "bg.wav").write_bytes(b"RIFFxxxx")
    with tarfile.open(archive, "w:gz") as tf:
        tf.add(root, arcname=arcname)
    return archive


def test_sanitize_label():
    assert ds._sanitize_label("Hey Studio") == "hey_studio"
    assert ds._sanitize_label("  stop ") == "stop"
    assert ds._sanitize_label("") == "word"


def test_write_silence_wav(tmp_path):
    p = ds.write_silence_wav(tmp_path / "s.wav", seconds=0.1, sample_rate=16000)
    assert p.is_file()
    with wave.open(str(p)) as w:
        assert w.getframerate() == 16000
        assert w.getnchannels() == 1
        assert w.getsampwidth() == 2


def test_extract_and_find_root_targz(tmp_path):
    root = tmp_path / "build" / "SpeechCommands" / "speech_commands_v0.02"
    archive = _make_archive(root, tmp_path / "ds.tar.gz", "SpeechCommands/speech_commands_v0.02")
    dest = tmp_path / "extract"
    ds.extract_archive(archive, dest)
    found = ds.find_data_root(dest)
    assert (found / "yes" / "a.wav").is_file()


def test_prepare_user_archive_file_url(tmp_path):
    root = tmp_path / "src" / "mydata"
    archive = _make_archive(root, tmp_path / "user.tar.gz", "mydata")
    found, prov = ds.prepare_user_archive(archive.as_uri(), tmp_path / "data")
    assert (found / "yes" / "a.wav").is_file()
    assert prov["commercialUse"] is False
    assert prov["source"] == archive.as_uri()


def test_prepare_speech_commands_v2(monkeypatch, tmp_path):
    root = tmp_path / "SpeechCommands" / "speech_commands_v0.02"
    archive = _make_archive(
        root, tmp_path / "sc.tar.gz", "SpeechCommands/speech_commands_v0.02"
    )
    monkeypatch.setattr(
        ds, "download_file",
        lambda url, dest, reporter=None: (
            dest.parent.mkdir(parents=True, exist_ok=True),
            shutil.copy(archive, dest),
        )[1],
    )
    found, prov = ds.prepare_speech_commands_v2(tmp_path / "data")
    assert (found / "yes" / "a.wav").is_file()
    assert prov["commercialUse"] is True
    assert "CC BY 4.0" in prov["license"]


def test_build_edge_tts_kws_dataset(monkeypatch, tmp_path):
    monkeypatch.setitem(sys.modules, "edge_tts", type("edge_tts", (), {})())
    monkeypatch.setattr(
        ds, "synthesize",
        lambda text, voice, mp3, **kw: (mp3.parent.mkdir(parents=True, exist_ok=True), mp3.write_bytes(b"mp3"))[1],
    )
    monkeypatch.setattr(
        ds, "mp3_to_wav",
        lambda mp3, wav, sample_rate=16000: (wav.parent.mkdir(parents=True, exist_ok=True), wav.write_bytes(b"RIFF"))[1],
    )

    prov = ds.build_edge_tts_kws_dataset(
        ["hey studio"],
        ["en-US", "zh-CN"],
        tmp_path / "tree",
        samples_per_phrase=2,
        unknown_words=["stop"],
    )

    positives = list((tmp_path / "tree" / "hey_studio").glob("*.wav"))
    assert len(positives) == 4  # 2 languages x 2 samples
    assert (tmp_path / "tree" / "stop" / "en-US_0.wav").is_file()
    assert (tmp_path / "tree" / "_background_noise_").is_dir()
    assert prov["commercialUse"] is True
    assert prov["languages"] == ["en-US", "zh-CN"]
