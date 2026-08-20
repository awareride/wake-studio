"""wake_train_kit.materialize tests (ADR-044 §6, #206).

No network / no numpy / no GPU: datasets are built as canonical zips in tmp
dirs (matching test_dataset_store helpers), and the openwakeword feature
extractor is a FAKE upstream returning a duck-typed feature array. Covers both
materializers (label-tree + openwakeword), merge/collision behavior, and the
requirements validation.
"""

import io
import json
import zipfile
from pathlib import Path

import pytest

from wake_train_kit import dataset as ds
from wake_train_kit import materialize as mat
from wake_train_kit.data_sources import DataSourceError
from wake_train_kit.dataset_store import DatasetStore


def _manifest(**overrides) -> dict:
    m = {
        "schemaVersion": ds.DATASET_MANIFEST_SCHEMA_VERSION,
        "id": "ds-1",
        "name": "wake-words",
        "version": 1,
        "kind": "generated",
        "role": "mixed",
        "audio": {"sampleRate": 16000, "channels": 1, "encoding": ds.CANONICAL_ENCODING, "clips": 4, "durationSec": 8},
        "labels": [
            {"name": "hey_studio", "role": "positive"},
            {"name": "_unknown", "role": "unknown"},
            {"name": "noise", "role": "noise"},
        ],
        "provenance": [
            {"name": "edge-tts synthetic speech", "license": "user-owned (synthetic TTS)", "commercialUse": True}
        ],
        "createdAtMs": 1700000000000,
    }
    m.update(overrides)
    return m


def _write_zip(tmp_path: Path, manifest: dict, clips=None) -> Path:
    clips = clips or {
        "hey_studio": {"a.wav": b"RIFF1", "b.wav": b"RIFF2"},
        "_unknown": {"x.wav": b"RIFF3"},
        "noise": {"bg.wav": b"RIFF4"},
    }
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("dataset.json", json.dumps(manifest))
        for label, clip_map in clips.items():
            for name, bytes_ in clip_map.items():
                zf.writestr(f"audio/{label}/{name}", bytes_)
    p = tmp_path / f"{manifest['id']}.zip"
    p.write_bytes(buf.getvalue())
    return p


def _store_with(tmp_path: Path, manifest: dict, clips=None) -> DatasetStore:
    store = DatasetStore(tmp_path / "datasets")
    store.save(_write_zip(tmp_path, manifest, clips))
    return store


# ---------------------------------------------------------------------------
# requirements validation (mirror of core/materialize.ts)
# ---------------------------------------------------------------------------

def test_validate_ok():
    v = mat.validate_datasets([_manifest()], {"sampleRate": 16000, "needsNoise": True, "needsUnknowns": True, "labelMode": "multi"})
    assert v.ok, v.errors
    assert v.errors == []


def test_validate_missing_noise_blocks():
    m = _manifest(labels=[{"name": "hey_studio", "role": "positive"}, {"name": "_unknown", "role": "unknown"}])
    v = mat.validate_datasets([m], {"needsNoise": True, "needsUnknowns": True, "labelMode": "multi"})
    assert not v.ok
    assert any("noise" in e for e in v.errors)


def test_validate_missing_unknowns_blocks():
    m = _manifest(labels=[{"name": "hey_studio", "role": "positive"}, {"name": "noise", "role": "noise"}])
    v = mat.validate_datasets([m], {"needsNoise": True, "needsUnknowns": True, "labelMode": "multi"})
    assert not v.ok
    assert any("unknown" in e for e in v.errors)


def test_validate_single_word_needs_one_positive():
    m = _manifest(labels=[
        {"name": "hey_studio", "role": "positive"},
        {"name": "good_morning", "role": "positive"},
        {"name": "noise", "role": "noise"},
    ])
    v = mat.validate_datasets([m], {"labelMode": "single"})
    assert not v.ok
    assert any("single" in e for e in v.errors)


def test_validate_combined_roles_across_datasets_ok():
    # positives from one dataset, noise from another: combined view is valid.
    pos = _manifest(id="pos", labels=[{"name": "hey_studio", "role": "positive"}])
    noise = _manifest(id="noise-ds", labels=[{"name": "noise", "role": "noise"}])
    v = mat.validate_datasets([pos, noise], {"needsNoise": True, "needsUnknowns": False, "labelMode": "single"})
    assert v.ok, v.errors


def test_validate_sample_rate_mismatch_warns_blocking():
    m = _manifest(audio={"sampleRate": 22050, "channels": 1, "encoding": "pcm_s16le", "clips": 4, "durationSec": 8})
    v = mat.validate_datasets([m], {"sampleRate": 16000})
    assert not v.ok
    assert any("22050" in e for e in v.errors)


def test_validate_min_clips_warns():
    m = _manifest()
    v = mat.validate_datasets(
        [m], {"minClipsPerLabel": 50},
        clips_per_dataset=[{"hey_studio": 2, "_unknown": 1, "noise": 1}],
    )
    assert v.ok  # thin labels are a warning, not a blocker
    assert any("hey_studio" in w and "50" in w for w in v.warnings)


def test_validate_non_commercial_warns():
    m = _manifest(provenance=[{"name": "x", "license": "NC", "commercialUse": False}])
    v = mat.validate_datasets([m], {"labelMode": "single"})
    assert v.ok
    assert any("NOT commercially usable" in w for w in v.warnings)


# ---------------------------------------------------------------------------
# kws-streaming materializer
# ---------------------------------------------------------------------------

def test_materialize_kws_streaming_role_folder_map(tmp_path):
    store = _store_with(tmp_path, _manifest(id="ds-1"))
    out = mat.materialize_kws_streaming(store, ["ds-1"], tmp_path / "out")

    # role → folder map: positive label folder + noise → _background_noise_
    assert (out.data_dir / "hey_studio" / "a.wav").is_file()
    assert (out.data_dir / "_unknown" / "x.wav").is_file()
    assert (out.data_dir / "_background_noise_" / "bg.wav").is_file()
    # positives are the wanted words
    assert out.wanted_words == "hey_studio"
    assert out.sources[0]["commercialUse"] is True


def test_materialize_kws_streaming_merges_multiple_datasets(tmp_path):
    pos = _manifest(id="pos", labels=[{"name": "hey_studio", "role": "positive"}])
    unk = _manifest(id="unk", labels=[{"name": "_unknown", "role": "unknown"}, {"name": "noise", "role": "noise"}])
    store = _store_with(tmp_path, pos, {"hey_studio": {"a.wav": b"RIFF1"}})
    store.save(_write_zip(tmp_path, unk, {"_unknown": {"x.wav": b"RIFF3"}, "noise": {"bg.wav": b"RIFF4"}}))

    out = mat.materialize_kws_streaming(store, ["pos", "unk"], tmp_path / "out")
    assert (out.data_dir / "hey_studio" / "a.wav").is_file()
    assert (out.data_dir / "_unknown" / "x.wav").is_file()
    assert (out.data_dir / "_background_noise_" / "bg.wav").is_file()
    assert out.wanted_words == "hey_studio"


def test_materialize_kws_streaming_label_collision_fails(tmp_path):
    labels = [
        {"name": "hey_studio", "role": "positive"},
        {"name": "_unknown", "role": "unknown"},
        {"name": "noise", "role": "noise"},
    ]
    a = _manifest(id="a", labels=labels)
    b = _manifest(id="b", labels=labels)
    clips_a = {"hey_studio": {"a.wav": b"RIFF1"}, "_unknown": {"x.wav": b"R"}, "noise": {"bg.wav": b"R"}}
    clips_b = {"hey_studio": {"z.wav": b"RIFF9"}, "_unknown": {"y.wav": b"R"}, "noise": {"bg.wav": b"R"}}
    store = _store_with(tmp_path, a, clips_a)
    store.save(_write_zip(tmp_path, b, clips_b))

    with pytest.raises(DataSourceError, match="collision"):
        mat.materialize_kws_streaming(store, ["a", "b"], tmp_path / "out")


def test_materialize_kws_streaming_no_positives_fails_cleanly(tmp_path):
    unk = _manifest(id="unk", labels=[{"name": "_unknown", "role": "unknown"}, {"name": "noise", "role": "noise"}])
    store = _store_with(tmp_path, unk, {"_unknown": {"x.wav": b"RIFF3"}, "noise": {"bg.wav": b"R"}})
    with pytest.raises(mat.MaterializeError, match="positive"):
        mat.materialize_kws_streaming(store, ["unk"], tmp_path / "out")


def test_materialize_kws_streaming_unknown_dataset(tmp_path):
    store = DatasetStore(tmp_path / "datasets")
    with pytest.raises(mat.MaterializeError, match="unknown dataset"):
        mat.materialize_kws_streaming(store, ["nope"], tmp_path / "out")


# ---------------------------------------------------------------------------
# openwakeword materializer
# ---------------------------------------------------------------------------

class FakeFeatures:
    """A numpy-array duck-type (no numpy in the test env)."""

    def __init__(self, frames: int = 98, mels: int = 40, seed: int = 0) -> None:
        self.shape = (frames, mels)
        self.dtype = "float32"
        self._seed = seed

    def tobytes(self) -> bytes:
        return (f"feats-{self._seed}-{self.shape[0]}x{self.shape[1]}-".encode() * 4)


def _fake_extractor(seed: int = 0):
    return lambda wav_path: FakeFeatures(frames=98, mels=40, seed=seed)


def test_materialize_openwakeword_shape(tmp_path):
    store = _store_with(tmp_path, _manifest(id="ds-1"))
    out = mat.materialize_openwakeword(
        store, ["ds-1"], tmp_path / "out", feature_extractor=_fake_extractor(1)
    )

    # positives dir, features .npy, background paths
    assert (out.positives_dir / "ds-1_hey_studio_a.wav").is_file()
    npy = out.features_dir / "_unknown.npy"
    assert npy.is_file()
    assert npy.read_bytes().startswith(b"\x93NUMPY")
    assert out.background_paths == [str(out.background_dir)]
    assert out.target_phrase == ["hey_studio"]
    assert "_unknown" in out.feature_data_files


def test_materialize_openwakeword_negative_features_written(tmp_path):
    store = _store_with(tmp_path, _manifest(id="ds-1"))
    out = mat.materialize_openwakeword(
        store, ["ds-1"], tmp_path / "out", feature_extractor=_fake_extractor(2)
    )
    npy = out.features_dir / "_unknown.npy"
    # header carries the float32 shape (98 frames, 40 mels), C-order
    header = npy.read_bytes()
    assert b"'descr': '<f4'" in header
    assert b"(98, 40)" in header


def test_materialize_openwakeword_no_background_no_paths(tmp_path):
    m = _manifest(labels=[{"name": "hey_studio", "role": "positive"}, {"name": "_unknown", "role": "unknown"}])
    store = _store_with(tmp_path, m, {"hey_studio": {"a.wav": b"R"}, "_unknown": {"x.wav": b"R"}})
    # a trainer that does not require noise (requirements param) gets no background paths
    out = mat.materialize_openwakeword(
        store, [m["id"]], tmp_path / "out", feature_extractor=_fake_extractor(),
        requirements={"needsNoise": False, "needsUnknowns": True, "labelMode": "single"},
    )
    assert out.background_paths == []


def test_materialize_openwakeword_no_positives_fails(tmp_path):
    unk = _manifest(id="unk", labels=[{"name": "_unknown", "role": "unknown"}])
    store = _store_with(tmp_path, unk, {"_unknown": {"x.wav": b"RIFF3"}})
    with pytest.raises(mat.MaterializeError, match="positive"):
        mat.materialize_openwakeword(
            store, ["unk"], tmp_path / "out", feature_extractor=_fake_extractor(),
            requirements={"needsNoise": False, "needsUnknowns": True, "labelMode": "single"},
        )
