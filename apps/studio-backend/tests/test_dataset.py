"""wake_train_kit.dataset tests (ADR-044, #203).

No network / no GPU: the dataset zip is built in-memory with the stdlib zipfile,
matching the canonical layout from docs/modules/data-sources.md §4.1. These tests
mirror the web-side vitest suite (spec + manifest) so both importers agree.
"""

import io
import json
import zipfile
from pathlib import Path

from wake_train_kit import dataset as ds


def _valid_manifest() -> dict:
    return {
        "schemaVersion": ds.DATASET_MANIFEST_SCHEMA_VERSION,
        "id": "ds-1",
        "name": "wake-words-zh-en",
        "version": 1,
        "kind": "generated",
        "role": "mixed",
        "audio": {"sampleRate": 16000, "channels": 1, "encoding": ds.CANONICAL_ENCODING, "clips": 3, "durationSec": 6},
        "labels": [
            {"name": "hey_studio", "role": "positive"},
            {"name": "noise", "role": "noise"},
        ],
        "provenance": [
            {"name": "edge-tts synthetic speech", "license": "user-owned (synthetic TTS)", "commercialUse": True}
        ],
        "recipe": {"engine": "edge-tts", "seed": 0},
    }


def _clips() -> dict[str, dict[str, bytes]]:
    return {
        "hey_studio": {"a.wav": b"RIFFfakewav", "b.wav": b"RIFFfakewav"},
        "noise": {"bg.wav": b"RIFFfakewav"},
    }


def _build_zip(manifest: dict, clips: dict[str, dict[str, bytes]]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("dataset.json", json.dumps(manifest))
        for label, clip_map in clips.items():
            for name, bytes_ in clip_map.items():
                zf.writestr(f"audio/{label}/{name}", bytes_)
    return buf.getvalue()


def _write_zip(tmp_path: Path, data: bytes) -> Path:
    p = tmp_path / "dataset.zip"
    p.write_bytes(data)
    return p


def test_validate_accepts_well_formed():
    ok, errors = ds.validate_dataset_manifest(_valid_manifest())
    assert ok is True
    assert errors == []


def test_validate_rejects_bad_role():
    m = _valid_manifest()
    m["labels"] = [{"name": "hey_studio", "role": "wanted"}]
    ok, errors = ds.validate_dataset_manifest(m)
    assert ok is False
    assert any("role" in e for e in errors)


def test_validate_rejects_non_canonical_encoding():
    m = _valid_manifest()
    m["audio"]["encoding"] = "mp3"
    ok, errors = ds.validate_dataset_manifest(m)
    assert ok is False
    assert any("encoding" in e for e in errors)


def test_validate_rejects_missing_commercial_use():
    m = _valid_manifest()
    m["provenance"] = [{"name": "x", "license": "CC0"}]
    ok, errors = ds.validate_dataset_manifest(m)
    assert ok is False
    assert any("commercialUse" in e for e in errors)


def test_load_dataset_manifest_roundtrip(tmp_path):
    p = tmp_path / "dataset.json"
    p.write_text(json.dumps(_valid_manifest()))
    manifest = ds.load_dataset_manifest(p)
    assert manifest["id"] == "ds-1"


def test_load_dataset_manifest_raises_on_invalid(tmp_path):
    p = tmp_path / "dataset.json"
    p.write_text(json.dumps({"schemaVersion": 1, "id": "x"}))
    try:
        ds.load_dataset_manifest(p)
        raise AssertionError("expected ValueError")
    except ValueError as exc:
        assert "invalid dataset.json" in str(exc)


def test_import_dataset_zip_indexes_audio(tmp_path):
    manifest, clips = ds.import_dataset_zip(_write_zip(tmp_path, _build_zip(_valid_manifest(), _clips())))
    assert manifest["id"] == "ds-1"
    assert clips["hey_studio"] == ["a.wav", "b.wav"]
    assert clips["noise"] == ["bg.wav"]


def test_import_dataset_zip_missing_manifest(tmp_path):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("audio/hey_studio/a.wav", b"RIFF")
    try:
        ds.import_dataset_zip(_write_zip(tmp_path, buf.getvalue()))
        raise AssertionError("expected ValueError")
    except ValueError as exc:
        assert "dataset.json is missing" in str(exc)


def test_import_dataset_zip_label_without_clips(tmp_path):
    m = _valid_manifest()
    try:
        ds.import_dataset_zip(
            _write_zip(tmp_path, _build_zip(m, {"hey_studio": {"a.wav": b"RIFF"}}))
        )
        raise AssertionError("expected ValueError")
    except ValueError as exc:
        assert "empty labels: noise" in str(exc)


def test_content_hash_roundtrip_and_change_detection():
    m = _valid_manifest()
    clips_bytes = {label: [(n, b) for n, b in clips.items()] for label, clips in _clips().items()}
    h1 = ds.dataset_content_hash(m, clips_bytes)

    # Same manifest + same clips -> same hash (deterministic).
    h2 = ds.dataset_content_hash(m, clips_bytes)
    assert h1 == h2

    # A changed clip -> different hash (change detection bumps version).
    changed = dict(clips_bytes, hey_studio=[("a.wav", b"RIFFchanged")])
    assert ds.dataset_content_hash(m, changed) != h1


def test_python_hash_matches_web_contract_shape():
    # The hash must be a 64-char sha256 hex string, matching the web importer's
    # contentHash format so a dataset produced by the backend imports in the browser.
    m = _valid_manifest()
    clips_bytes = {label: [(n, b) for n, b in clips.items()] for label, clips in _clips().items()}
    h = ds.dataset_content_hash(m, clips_bytes)
    assert len(h) == 64
    assert all(c in "0123456789abcdef" for c in h)

    # Deterministic regardless of clip insertion order (sorted by name).
    reordered = {
        "hey_studio": [(n, b) for n, b in reversed(_clips()["hey_studio"].items())],
        "noise": [(n, b) for n, b in _clips()["noise"].items()],
    }
    assert ds.dataset_content_hash(m, reordered) == h
