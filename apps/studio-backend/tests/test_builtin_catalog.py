"""wake_train_kit.builtin_catalog tests (ADR-044 §7, #207).

No network: the SC2 converter is monkeypatched to build a small fake label
tree (the real `prepare_speech_commands_v2` would download the 2.3 GB archive,
which L1 tests must never do), and canonical-zip downloads copy a local file.
Covers loading the curated catalog, materialize-on-first-use for both wired
types, the pending-host clear error, idempotency, and that materializers
resolve a built-in id end-to-end.
"""

import io
import json
import shutil
import zipfile
from pathlib import Path

import pytest

from wake_train_kit import builtin_catalog as bc
from wake_train_kit import dataset as ds
from wake_train_kit import materialize as mat
from wake_train_kit.dataset_store import DatasetStore


def _sc2_tree(root: Path) -> Path:
    """A minimal fake SC2 label tree — every label the catalog entry declares
    (the real archive has all of them; the fake must too so the packed zip
    imports: every declared label needs >= 1 clip)."""
    labels = ("yes", "no", "up", "down", "left", "right",
              "on", "off", "stop", "go", "_silence_", "_background_noise_")
    for label in labels:
        d = root / label
        d.mkdir(parents=True, exist_ok=True)
        for i in range(2):
            (d / f"{label}_{i}.wav").write_bytes(b"RIFFfakewav")
    return root


def _fake_sc2_source(monkeypatch) -> None:
    """Replace the SC2 converter with a fake that builds a local tree — never
    the real 2.3 GB network download (ADR-026 L1: no network in tests)."""

    def fake_prepare(data_dir, reporter=None):
        root = _sc2_tree(Path(data_dir))
        return root, {
            "name": "Google Speech Commands V2 (speech_commands_v0.02)",
            "license": "CC BY 4.0 (attribution required)",
            "commercialUse": True,
        }

    monkeypatch.setattr(bc, "prepare_speech_commands_v2", fake_prepare)


def test_catalog_loads_entries():
    entries = bc.load_catalog()
    ids = {e["id"] for e in entries}
    assert ids >= {
        "speech-commands-v2",
        "google-speech-commands",
        "common-voice",
        "audioset-fma-noise",
    }
    # every entry carries the export-gate input
    for e in entries:
        assert e["kind"] == "builtin"
        assert e.get("provenance") and isinstance(e["provenance"][0].get("commercialUse"), bool)


def test_catalog_entry_lookup():
    assert bc.entry("speech-commands-v2")["materialize"]["type"] == "speech-commands-v2"
    assert bc.entry("nope") is None
    assert bc.is_builtin("speech-commands-v2") is True
    assert bc.is_builtin("nope") is False


def test_ensure_builtin_speech_commands_v2(tmp_path, monkeypatch):
    _fake_sc2_source(monkeypatch)
    store = DatasetStore(tmp_path / "datasets")
    manifest = bc.ensure_builtin(store, "speech-commands-v2", tmp_path / "work")

    assert manifest["id"] == "speech-commands-v2"
    assert manifest["kind"] == "builtin"
    assert manifest["audio"]["clips"] == 24  # 12 labels × 2 clips
    # the stored zip imports + verifies (contentHash round-trip)
    stored = store.path("speech-commands-v2")
    assert stored is not None and stored.is_file()
    imported_manifest, _clips = ds.import_dataset_zip(stored)
    assert imported_manifest["id"] == "speech-commands-v2"
    assert imported_manifest["contentHash"] == manifest["contentHash"]
    assert imported_manifest["provenance"][0]["commercialUse"] is True


def test_ensure_builtin_is_idempotent(tmp_path, monkeypatch):
    _fake_sc2_source(monkeypatch)
    store = DatasetStore(tmp_path / "datasets")
    first = bc.ensure_builtin(store, "speech-commands-v2", tmp_path / "work")
    second = bc.ensure_builtin(store, "speech-commands-v2", tmp_path / "work")
    assert first == second  # no re-download / no re-save


def test_ensure_builtin_canonical_zip(tmp_path, monkeypatch):
    # a minimal canonical zip copied locally (no network)
    manifest = {
        "schemaVersion": ds.DATASET_MANIFEST_SCHEMA_VERSION,
        "id": "some-hosted-builtin",
        "name": "Hosted Builtin",
        "version": 1,
        "kind": "builtin",
        "role": "unknowns",
        "audio": {"sampleRate": 16000, "channels": 1, "encoding": "pcm_s16le", "clips": 1, "durationSec": 2},
        "labels": [{"name": "unknown", "role": "unknown"}],
        "provenance": [{"name": "x", "license": "CC0", "commercialUse": True}],
    }
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("dataset.json", json.dumps(manifest))
        zf.writestr("audio/unknown/a.wav", b"RIFFwav")
    zip_path = tmp_path / "builtin.zip"
    zip_path.write_bytes(buf.getvalue())

    monkeypatch.setattr(
        bc, "download_file",
        lambda url, dest, reporter=None: (
            dest.parent.mkdir(parents=True, exist_ok=True),
            shutil.copy(zip_path, dest),
        )[1],
    )
    original_load = bc.load_catalog

    def fake_load():
        entries = original_load()
        entries.append({**manifest, "storage": {"url": zip_path.as_uri()},
                        "materialize": {"type": "canonical-zip", "url": zip_path.as_uri()}})
        return entries

    monkeypatch.setattr(bc, "load_catalog", fake_load)

    store = DatasetStore(tmp_path / "datasets")
    got = bc.ensure_builtin(store, "some-hosted-builtin", tmp_path / "work")
    assert got["id"] == "some-hosted-builtin"
    assert store.get("some-hosted-builtin") is not None


def test_ensure_builtin_pending_host_raises_clear_error(tmp_path):
    store = DatasetStore(tmp_path / "datasets")
    with pytest.raises(bc.BuiltinCatalogError, match="not yet hosted"):
        bc.ensure_builtin(store, "common-voice", tmp_path / "work")


def test_ensure_builtin_unknown_id(tmp_path):
    store = DatasetStore(tmp_path / "datasets")
    with pytest.raises(bc.BuiltinCatalogError, match="unknown dataset"):
        bc.ensure_builtin(store, "nope", tmp_path / "work")


def test_materialize_resolves_builtin_id(tmp_path, monkeypatch):
    """A built-in id picked in the wizard works end-to-end: materialize pulls
    it into the store on first use, then merges it as the unknown/noise half."""
    _fake_sc2_source(monkeypatch)
    store = DatasetStore(tmp_path / "datasets")
    # SC2 alone has no positive label → it can't be the whole training set; use
    # it as the unknown/noise half merged with a small positive dataset.
    pos = {
        "schemaVersion": 1, "id": "pos", "name": "positives", "version": 1,
        "kind": "generated", "role": "positive",
        "audio": {"sampleRate": 16000, "channels": 1, "encoding": "pcm_s16le", "clips": 1, "durationSec": 2},
        "labels": [{"name": "hey_studio", "role": "positive"}],
        "provenance": [{"name": "tts", "license": "user-owned", "commercialUse": True}],
    }
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("dataset.json", json.dumps(pos))
        zf.writestr("audio/hey_studio/a.wav", b"RIFFwav")
    pos_zip = tmp_path / "pos.zip"
    pos_zip.write_bytes(buf.getvalue())
    store.save(pos_zip)

    out = mat.materialize_kws_streaming(store, ["pos", "speech-commands-v2"], tmp_path / "out")
    # the built-in was materialized into the store + merged as unknowns/noise
    assert store.get("speech-commands-v2") is not None
    assert (out.data_dir / "hey_studio" / "a.wav").is_file()
    assert (out.data_dir / "yes").is_dir()  # SC2 unknowns folded in
    assert (out.data_dir / "_background_noise_").is_dir()  # SC2 noise
    assert out.wanted_words == "hey_studio"
