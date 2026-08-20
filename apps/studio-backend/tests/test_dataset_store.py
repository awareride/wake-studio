"""wake_train_kit.dataset_store tests (ADR-044 #204).

No network / no GPU: dataset zips are built in-memory with the stdlib zipfile
(matching test_dataset.py helpers). Covers: save/get/list/delete round-trip,
restart persistence (a fresh DatasetStore over the same dir sees the data),
duplicate-save upsert, invalid-zip rejection, and sha256/size registration.
"""

import io
import json
import zipfile
from pathlib import Path

import pytest

from wake_train_kit import dataset as ds
from wake_train_kit.dataset_store import DatasetStore, DatasetStoreError


def _valid_manifest(**overrides) -> dict:
    m = {
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
        "createdAtMs": 1700000000000,
    }
    m.update(overrides)
    return m


def _write_zip(tmp_path: Path, manifest: dict, clips=None) -> Path:
    clips = clips or {
        "hey_studio": {"a.wav": b"RIFFfakewav", "b.wav": b"RIFFfakewav"},
        "noise": {"bg.wav": b"RIFFfakewav"},
    }
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("dataset.json", json.dumps(manifest))
        for label, clip_map in clips.items():
            for name, bytes_ in clip_map.items():
                zf.writestr(f"audio/{label}/{name}", bytes_)
    p = tmp_path / "wake-studio-dataset.zip"
    p.write_bytes(buf.getvalue())
    return p


def test_save_registers_and_round_trips(tmp_path):
    store = DatasetStore(tmp_path / "datasets")
    zip_path = _write_zip(tmp_path, _valid_manifest())

    record = store.save(zip_path)
    assert record["id"] == "ds-1"
    assert record["sha256"]
    assert len(record["sha256"]) == 64
    assert record["size_bytes"] == zip_path.stat().st_size
    assert record["manifest"]["id"] == "ds-1"

    # canonical layout: datasets/<id>/wake-studio-dataset.zip
    stored = Path(record["stored_path"])
    assert stored.is_file()
    assert stored.relative_to(tmp_path / "datasets").parts == ("ds-1", "wake-studio-dataset.zip")

    got = store.get("ds-1")
    assert got is not None
    assert got["name"] == "wake-words-zh-en"
    assert store.path("ds-1") == stored
    assert store.load_manifest("ds-1")["labels"][0]["name"] == "hey_studio"
    store.close()


def test_persists_across_restarts(tmp_path):
    """A fresh DatasetStore over the same dir sees prior data (survives restart)."""
    zip_path = _write_zip(tmp_path, _valid_manifest())
    s1 = DatasetStore(tmp_path / "datasets")
    s1.save(zip_path)
    s1.close()

    s2 = DatasetStore(tmp_path / "datasets")
    records = s2.list()
    assert [r["id"] for r in records] == ["ds-1"]
    assert s2.get("ds-1") is not None
    assert s2.path("ds-1").is_file()
    s2.close()


def test_delete_removes_file_and_index(tmp_path):
    store = DatasetStore(tmp_path / "datasets")
    store.save(_write_zip(tmp_path, _valid_manifest()))
    assert store.get("ds-1") is not None

    store.delete("ds-1")
    assert store.get("ds-1") is None
    assert store.path("ds-1") is None
    assert not (tmp_path / "datasets" / "ds-1").exists()
    store.close()


def test_duplicate_save_upserts_same_id(tmp_path):
    store = DatasetStore(tmp_path / "datasets")
    store.save(_write_zip(tmp_path, _valid_manifest(version=1)))
    store.save(_write_zip(tmp_path, _valid_manifest(version=2)))
    got = store.get("ds-1")
    assert got["version"] == 2
    assert len(store.list()) == 1
    store.close()


def test_save_rejects_invalid_zip(tmp_path):
    store = DatasetStore(tmp_path / "datasets")
    bad = tmp_path / "bad.zip"
    bad.write_bytes(b"not a zip")
    with pytest.raises(DatasetStoreError, match="invalid dataset zip"):
        store.save(bad)
    store.close()


def test_save_rejects_missing_file(tmp_path):
    store = DatasetStore(tmp_path / "datasets")
    with pytest.raises(DatasetStoreError, match="dataset zip not found"):
        store.save(tmp_path / "nope.zip")
    store.close()


def test_list_orders_newest_first(tmp_path):
    store = DatasetStore(tmp_path / "datasets")
    store.save(_write_zip(tmp_path, _valid_manifest(id="a", createdAtMs=1000)))
    store.save(_write_zip(tmp_path, _valid_manifest(id="b", createdAtMs=2000)))
    assert [r["id"] for r in store.list()] == ["b", "a"]
    store.close()
