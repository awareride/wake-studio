"""wake_train_kit.storage tests (ADR-044 §5.3, #204).

No real cloud: backend-disk + url (file://) are exercised for real; hf/r2/gdrive
are checked as REGISTERED descriptors that raise a clear error when their SDK is
missing; a FAKE in-memory adapter proves the interface + registry end-to-end.
"""

from pathlib import Path

import pytest

from wake_train_kit.storage import (
    STORAGE_REGISTRY,
    ALL_CAPABILITIES,
    BackendDiskStorage,
    CloudflareR2Storage,
    GoogleDriveStorage,
    HuggingFaceStorage,
    StorageBackend,
    StorageBackendError,
    StorageRegistry,
    UrlStorage,
)


def test_builtin_descriptors_and_authkeys():
    """Each storage plugin declares its authKey + capabilities (Settings group)."""
    by_id = {d["id"]: d for d in STORAGE_REGISTRY.descriptors()}
    assert set(by_id) == {"backend-disk", "hf", "r2", "gdrive", "url"}

    assert by_id["backend-disk"]["kind"] == "local"
    assert by_id["backend-disk"]["authKey"] is None
    assert set(by_id["backend-disk"]["capabilities"]) == set(ALL_CAPABILITIES)

    assert by_id["hf"]["authKey"] == "cloud.hf"
    assert by_id["r2"]["authKey"] == "cloud.r2"
    assert by_id["gdrive"]["authKey"] == "cloud.gdrive"
    assert by_id["url"]["authKey"] is None
    assert by_id["url"]["capabilities"] == ["pull"]  # read-only

    assert all(d["format"] == "zip" for d in by_id.values())


def test_registry_get_and_unknown():
    backend = STORAGE_REGISTRY.get("backend-disk")
    assert isinstance(backend, BackendDiskStorage)
    assert backend.id == "backend-disk"

    with pytest.raises(StorageBackendError, match="unknown storage backend 'nope'"):
        STORAGE_REGISTRY.get("nope")


def test_backend_disk_push_pull_list_delete(tmp_path):
    registry = StorageRegistry()
    registry.register(BackendDiskStorage)
    disk = registry.get("backend-disk")
    base = tmp_path / "base"
    creds = {"dir": str(base)}

    src = tmp_path / "src.zip"
    src.write_bytes(b"zipdata")

    ref = disk.push(src, "datasets/ds-1/wake-studio-dataset.zip", creds)
    assert ref == "datasets/ds-1/wake-studio-dataset.zip"
    assert (base / ref).read_bytes() == b"zipdata"

    # list under a prefix
    refs = disk.list("datasets/", creds)
    assert refs == ["datasets/ds-1/wake-studio-dataset.zip"]

    # pull back out
    out = tmp_path / "out.zip"
    disk.pull(ref, out, creds)
    assert out.read_bytes() == b"zipdata"

    # delete
    disk.delete(ref, creds)
    assert disk.list("datasets/", creds) == []


def test_url_backend_pull_file_and_read_only(tmp_path):
    registry = StorageRegistry()
    registry.register(UrlStorage)
    url = registry.get("url")
    assert "push" not in url.capabilities

    src = tmp_path / "public.zip"
    src.write_bytes(b"remote-bytes")
    dest = tmp_path / "downloaded.zip"
    pulled = url.pull(src.as_uri(), dest, {})
    assert pulled == dest
    assert dest.read_bytes() == b"remote-bytes"

    with pytest.raises(StorageBackendError, match="does not support 'push'"):
        url.push(src, "x", {})
    with pytest.raises(StorageBackendError, match="does not support 'delete'"):
        url.delete("x", {})


def test_cloud_adapters_raise_clear_error_without_sdk(monkeypatch):
    """hf/r2/gdrive are registered; without their SDK they fail loudly, never
    silently no-op. (Real SDK calls land with issue #107 — no real cloud here.)"""
    import wake_train_kit.storage as storage_mod

    monkeypatch.setattr(storage_mod, "_importable", lambda name: False)
    for backend_id in ("hf", "r2", "gdrive"):
        backend = STORAGE_REGISTRY.get(backend_id)
        with pytest.raises(StorageBackendError, match="requires"):
            backend.push("x.zip", "dest", {})


def test_fake_adapter_through_registry(tmp_path):
    """A fake adapter (no real cloud) proves the interface end-to-end."""

    class FakeCloud(StorageBackend):
        id = "fake"
        kind = "fake-cloud"
        authKey = "cloud.fake"
        capabilities = ALL_CAPABILITIES
        store: dict[str, bytes] = {}

        def _push(self, src, dest, creds):
            FakeCloud.store[dest] = Path(src).read_bytes()
            return dest

        def _pull(self, src, dest, creds):
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(FakeCloud.store[src])
            return dest

        def _list(self, prefix, creds):
            return sorted(k for k in FakeCloud.store if k.startswith(prefix))

        def _delete(self, ref, creds):
            FakeCloud.store.pop(ref, None)

    registry = StorageRegistry()
    registry.register(FakeCloud)
    assert registry.has("fake")
    assert registry.get("fake").descriptor()["authKey"] == "cloud.fake"

    fake = registry.get("fake")
    src = tmp_path / "ds.zip"
    src.write_bytes(b"payload")
    ref = fake.push(src, "datasets/ds-1.zip", {"token": "k"})
    assert fake.list("datasets/", {}) == ["datasets/ds-1.zip"]
    out = tmp_path / "back.zip"
    fake.pull(ref, out, {})
    assert out.read_bytes() == b"payload"
    fake.delete(ref, {})
    assert fake.list("", {}) == []


def test_registry_duplicate_rejected():
    registry = StorageRegistry()
    registry.register(BackendDiskStorage)
    with pytest.raises(StorageBackendError, match="duplicate storage backend id"):
        registry.register(BackendDiskStorage)
