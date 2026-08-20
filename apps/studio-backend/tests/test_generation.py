"""wake_train_kit.generation tests (ADR-044 §5, #205).

No network / no GPU: edge-tts is monkeypatched at `wake_train_kit.data_sources`
(writes a fake label tree), and the online HTTP engine is loaded with an
injected fake `post_json`. Engines are module-owned adapters loaded via
`generation.load_engine` (packages/modules/data/<id>/adapter.py); the produced
canonical `wake-studio-dataset.zip` is re-imported with `wake_train_kit.dataset`
so the generate -> pack -> import -> verify contentHash round-trip is covered.
"""

import base64
import os
from pathlib import Path

import pytest

from wake_train_kit import generation as gen
from wake_train_kit import dataset as ds
from wake_train_kit.data_sources import DataSourceError
from wake_train_kit.generation_runner import read_params, main as runner_main


class _FakeReporter:
    """Collects NDJSON events without touching stdout."""

    def __init__(self):
        self.events = []

    def emit(self, event, **fields):
        self.events.append({"event": event, **fields})

    def progress(self, **fields):
        self.emit("progress", **fields)

    def log(self, level="info", message=""):
        self.emit("log", level=level, message=message)

    def error(self, message):
        self.emit("error", message=message)

    def done(self, exit_code=0):
        self.emit("done", exitCode=exit_code)

    def artifact(self, path):
        self.emit("artifact", path=path)


def _fake_edge_tts(phrases, languages, out_dir, samples_per_phrase=3,
                   unknown_words=None, voices=None, reporter=None, **kwargs):
    """Monkeypatched edge-tts: writes a fake label/*.wav tree + provenance."""
    from wake_train_kit.data_sources import _sanitize_label
    out_dir = Path(out_dir)
    for phrase in phrases:
        label_dir = out_dir / _sanitize_label(phrase)
        label_dir.mkdir(parents=True, exist_ok=True)
        for i in range(samples_per_phrase):
            (label_dir / f"{languages[0]}_{i}.wav").write_bytes(b"RIFFfake")
    for word in unknown_words or []:
        label_dir = out_dir / _sanitize_label(word)
        label_dir.mkdir(parents=True, exist_ok=True)
        (label_dir / f"{languages[0]}_0.wav").write_bytes(b"RIFFfake")
    bg = out_dir / "_background_noise_"
    bg.mkdir(parents=True, exist_ok=True)
    for i in range(3):
        (bg / f"silence_{i}.wav").write_bytes(b"RIFFfake")
    return {
        "name": "edge-tts synthetic speech (multi-language)",
        "license": "user-owned (synthetic TTS)",
        "source": "https://github.com/rany2/edge-tts",
        "commercialUse": True,
        "languages": languages,
        "phrases": phrases,
        "clips": len(phrases) * samples_per_phrase,
    }


@pytest.fixture
def fake_edge_tts(monkeypatch):
    monkeypatch.setattr("wake_train_kit.data_sources.build_edge_tts_kws_dataset", _fake_edge_tts)


def _pcm16(seconds=0.25, sample_rate=16000):
    import struct
    return b"".join(struct.pack("<h", 0) for _ in range(int(seconds * sample_rate)))


def _fake_http_post(output_format="pcm16"):
    def post(url, headers, payload):
        fmt = (payload.get("audio") or {}).get("format", output_format)
        if fmt == "pcm16":
            content = base64.b64encode(_pcm16()).decode("ascii")
            return {"choices": [{"message": {"content": content}}]}
        raise AssertionError(f"unexpected format {fmt}")
    return post


# --- engine dispatch + pipeline ------------------------------------------------

def test_unknown_engine_raises(tmp_path):
    with pytest.raises(gen.GenerationError, match="unknown TTS engine"):
        gen.generate_dataset({"engine": "nope", "phrases": "hey studio"}, tmp_path)


def test_load_engine_discovers_module_adapters():
    engine = gen.load_engine("edge-tts")
    assert engine.id == "edge-tts"
    assert engine.kind == "classic-tts"
    engine = gen.load_engine("mimo-tts")
    assert engine.id == "mimo-tts"
    assert engine.kind == "online-http-tts"
    assert engine.default_model == "mimo-v2.5-tts"


def test_edge_tts_generates_canonical_dataset(tmp_path, fake_edge_tts):
    zip_path = gen.generate_dataset(
        {"engine": "edge-tts", "phrases": "hey studio, good morning",
         "languages": "en-US", "samplesPerPhrase": 2, "postprocess": "passthrough"},
        tmp_path,
    )
    assert zip_path.is_file()

    manifest, clips = ds.import_dataset_zip(zip_path)
    assert manifest["id"]
    assert manifest["kind"] == "generated"
    assert manifest["audio"]["encoding"] == "pcm_s16le"
    assert clips["hey_studio"] == ["en-US_0.wav", "en-US_1.wav"]
    assert manifest["contentHash"]  # computed at pack time
    assert manifest["provenance"][0]["commercialUse"] is True


def test_generate_emits_ndjson_progress(tmp_path, fake_edge_tts):
    reporter = _FakeReporter()
    gen.generate_dataset(
        {"engine": "edge-tts", "phrases": "hey studio", "postprocess": "passthrough"},
        tmp_path, reporter,
    )
    kinds = [e["event"] for e in reporter.events]
    assert "log" in kinds
    assert any(e["event"] == "progress" and e.get("message") == "synthesize" for e in reporter.events)
    assert any(e["event"] == "progress" and e.get("message") == "assemble" for e in reporter.events)


# --- online HTTP engine (mimo-tts / llm-tts) ----------------------------------

def test_online_http_engine_synthesizes(tmp_path):
    engine = gen.load_engine("mimo-tts", post_json=_fake_http_post())
    result = engine.synthesize(
        {"phrases": "hey studio", "languages": "en-US", "samplesPerPhrase": 2,
         "model": "mimo-v2.5-tts", "apiKey": "k", "sampleRate": 16000},
        tmp_path, _FakeReporter(),
    )
    clips = sorted((tmp_path / "hey_studio").glob("*.wav"))
    assert len(clips) == 2
    assert clips[0].read_bytes().startswith(b"RIFF")
    assert any(l["role"] == "positive" for l in result["labels"])
    assert any(l["role"] == "noise" for l in result["labels"])


def test_online_http_full_generate_roundtrip(tmp_path, monkeypatch):
    orig_load = gen.load_engine

    def _fake_load(engine_id, **kwargs):
        if engine_id == "mimo-tts":
            return orig_load(engine_id, post_json=_fake_http_post())
        return orig_load(engine_id, **kwargs)

    monkeypatch.setattr(gen, "load_engine", _fake_load)

    zip_path = gen.generate_dataset(
        {"engine": "mimo-tts", "phrases": "hey studio", "languages": "en-US",
         "samplesPerPhrase": 2, "apiKey": "k", "sampleRate": 16000,
         "postprocess": "passthrough"},
        tmp_path,
    )
    manifest, clips = ds.import_dataset_zip(zip_path)
    assert clips["hey_studio"]
    assert manifest["recipe"]["engine"] == "mimo-tts"


def test_online_http_missing_audio_is_clear_error(tmp_path):
    def bad_post(url, headers, payload):
        return {"choices": []}
    engine = gen.load_engine("mimo-tts", post_json=bad_post)
    with pytest.raises(gen.GenerationError, match="missing audio"):
        engine.synthesize({"phrases": "hey", "apiKey": "k", "sampleRate": 16000}, tmp_path, _FakeReporter())


# --- postprocess ---------------------------------------------------------------

def test_postprocess_passthrough_is_identity(tmp_path, fake_edge_tts):
    gen.generate_dataset({"engine": "edge-tts", "phrases": "hey studio",
                          "postprocess": "passthrough"}, tmp_path)
    clips = list((tmp_path / "audio" / "hey_studio").glob("*.wav"))
    assert len(clips) > 0
    assert all("__aug" not in c.name for c in clips)


def test_postprocess_openwakeword_requires_ffmpeg(tmp_path, fake_edge_tts, monkeypatch):
    from wake_train_kit import postprocess
    monkeypatch.setattr(postprocess.shutil, "which", lambda name: None)
    with pytest.raises(DataSourceError, match="requires ffmpeg"):
        gen.generate_dataset({"engine": "edge-tts", "phrases": "hey studio",
                              "postprocess": "openwakeword-style"}, tmp_path)


def test_postprocess_unknown_transform_raises(tmp_path, fake_edge_tts):
    with pytest.raises(DataSourceError, match="unknown postprocess"):
        gen.generate_dataset({"engine": "edge-tts", "phrases": "hey studio",
                              "postprocess": "magic"}, tmp_path)


# --- registry + runner ----------------------------------------------------------

def test_registry_has_dataset_generate_entry(tmp_path):
    from wake_training_service.registry import Registry
    reg = Registry.load("registry.json")
    assert reg.has("dataset-generate")
    cmd, cwd, env = reg.resolve("dataset-generate", {"engine": "edge-tts", "phrases": "hey"})
    assert "generation_runner.py" in cmd[-1]
    assert env["GEN_ENGINE"] == "edge-tts"
    assert env["WAKE_PARAMS"]


def test_runner_read_params_env():
    params = read_params({"GEN_ENGINE": "mimo-tts", "GEN_PHRASES": "hey,hi",
                          "GEN_SAMPLES": "5"})
    assert params["engine"] == "mimo-tts"
    assert params["samplesPerPhrase"] == 5


def test_runner_main_emits_artifact_and_done(tmp_path, fake_edge_tts, monkeypatch):
    class _CollectReporter:
        def __init__(self):
            self.events = []
        def emit(self, event, **fields):
            self.events.append({"event": event, **fields})

    reporter = _CollectReporter()
    monkeypatch.setattr("wake_train_kit.generation_runner.Reporter", lambda: reporter)
    monkeypatch.setattr(os, "environ", {
        **os.environ,
        "GEN_ENGINE": "edge-tts",
        "GEN_PHRASES": "hey studio",
        "GEN_LANGUAGES": "en-US",
        "GEN_SAMPLES": "2",
        "GEN_POSTPROCESS": "passthrough",
        "WORK_DIR": str(tmp_path),
    })

    code = runner_main([])
    assert code == 0
    kinds = [e["event"] for e in reporter.events]
    assert "artifact" in kinds and "done" in kinds
    zip_path = next(e["path"] for e in reporter.events if e["event"] == "artifact")
    assert Path(zip_path).is_file()
    manifest, clips = ds.import_dataset_zip(zip_path)
    assert clips["hey_studio"]


def test_runner_main_requires_phrase(tmp_path, monkeypatch):
    class _Reporter:
        def __init__(self):
            self.events = []
        def emit(self, event, **fields):
            self.events.append({"event": event, **fields})

    reporter = _Reporter()
    monkeypatch.setattr("wake_train_kit.generation_runner.Reporter", lambda: reporter)
    monkeypatch.setattr(os, "environ", {**os.environ, "GEN_ENGINE": "edge-tts",
                                        "GEN_PHRASES": "", "WORK_DIR": str(tmp_path)})
    assert runner_main([]) == 1
    assert any(e["event"] == "error" for e in reporter.events)
