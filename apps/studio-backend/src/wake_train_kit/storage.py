"""wake_train_kit.storage — StorageBackend plugin interface + registry (ADR-044 §5.3, #204).

Persistence is a **plugin** behind one interface (``push`` / ``pull`` /
``list`` / ``delete``), the storage-side twin of the TTS engine plugins
(ADR-033 self-registration): ``backend-disk`` (default), ``huggingface``
(dataset repo), ``cloudflare-r2`` (S3-compatible), ``google-drive``, ``url``
(built-in / public, READ-ONLY). Each backend declares its ``authKey`` — the
Settings "Cloud storage" key holding its credentials (client-side, masked,
never logged or exported — same guarantees as ``backend.apiKey``).

Backend contract (docs/modules/data-sources.md §5.3)::

    { "id": "r2", "kind": "s3-compatible", "authKey": "cloud.r2",
      "capabilities": ["push", "pull", "list", "delete"], "format": "zip" }

``backend-disk`` and ``url`` are fully implemented here (local copy + read-only
download). The cloud adapters (``hf`` / ``r2`` / ``gdrive``) are registered with
their descriptors and raise a clear, actionable error when their optional SDK
is not installed — real SDK wiring lands with the cloud-provider adapter work
(issue #107) / the push-job console (#208); the acceptance tests use FAKE
adapters behind the same interface (no real cloud).
"""

from __future__ import annotations

import abc
import os
import shutil
from pathlib import Path
from typing import Any

CAP_PUSH = "push"
CAP_PULL = "pull"
CAP_LIST = "list"
CAP_DELETE = "delete"

ALL_CAPABILITIES = frozenset({CAP_PUSH, CAP_PULL, CAP_LIST, CAP_DELETE})


class StorageBackendError(RuntimeError):
    """Raised when a storage backend cannot perform an operation."""


class StorageBackend(abc.ABC):
    """One storage backend behind the push/pull/list/delete interface.

    Subclasses declare their identity (``id`` / ``kind`` / ``authKey`` /
    ``capabilities`` / ``format``) and implement the ``_push`` / ``_pull`` /
    ``_list`` / ``_delete`` hooks. The public wrappers gate on capabilities so
    a backend that cannot ``delete`` fails loudly instead of silently no-op'ing.
    """

    id: str = ""
    kind: str = ""
    authKey: str | None = None
    capabilities: frozenset[str] = frozenset()
    format: str = "zip"

    # --- descriptor ---------------------------------------------------------
    def descriptor(self) -> dict[str, Any]:
        """The plugin descriptor (Settings "Cloud storage" + registry catalog)."""
        return {
            "id": self.id,
            "kind": self.kind,
            "authKey": self.authKey,
            "capabilities": sorted(self.capabilities),
            "format": self.format,
        }

    def check(self) -> None:
        """Raise ``StorageBackendError`` if the backend cannot run here.

        Default: no-op. Cloud adapters override to require their optional SDK.
        """
        return

    # --- public interface (capability-gated) --------------------------------
    def push(self, src: Path | str, dest: str, creds: dict[str, Any] | None = None) -> str:
        """Upload/persist the local file at ``src`` to the backend ref ``dest``.

        Returns a backend reference string (e.g. the remote path / object key).
        """
        self.check()
        self._require(CAP_PUSH)
        return self._push(Path(src), dest, creds or {})

    def pull(self, src: str, dest: Path | str, creds: dict[str, Any] | None = None) -> Path:
        """Fetch the backend ref ``src`` into the local path ``dest``."""
        self.check()
        self._require(CAP_PULL)
        return self._pull(src, Path(dest), creds or {})

    def list(self, prefix: str = "", creds: dict[str, Any] | None = None) -> list[str]:
        """List backend refs under ``prefix`` (may be empty for the root)."""
        self.check()
        self._require(CAP_LIST)
        return self._list(prefix, creds or {})

    def delete(self, ref: str, creds: dict[str, Any] | None = None) -> None:
        """Delete the backend ref (no-op-safe: missing refs are not an error)."""
        self.check()
        self._require(CAP_DELETE)
        self._delete(ref, creds or {})

    # --- hooks ----------------------------------------------------------------
    def _push(self, src: Path, dest: str, creds: dict[str, Any]) -> str:
        raise NotImplementedError

    def _pull(self, src: str, dest: Path, creds: dict[str, Any]) -> Path:
        raise NotImplementedError

    def _list(self, prefix: str, creds: dict[str, Any]) -> list[str]:
        raise NotImplementedError

    def _delete(self, ref: str, creds: dict[str, Any]) -> None:
        raise NotImplementedError

    # --- helpers --------------------------------------------------------------
    def _require(self, op: str) -> None:
        if op not in self.capabilities:
            raise StorageBackendError(
                f"storage backend '{self.id}' does not support '{op}'"
                f" (capabilities: {sorted(self.capabilities)})"
            )


class BackendDiskStorage(StorageBackend):
    """Local-directory backend (default). ``creds['dir']`` (or
    ``WAKE_STORAGE_DISK_DIR`` env) is the base directory; refs are paths under
    it. Fully local — used by the datasets store and by backend push jobs to a
    local target folder."""

    id = "backend-disk"
    kind = "local"
    authKey = None
    capabilities = ALL_CAPABILITIES

    def _base(self, creds: dict[str, Any]) -> Path:
        base = creds.get("dir") or os.environ.get("WAKE_STORAGE_DISK_DIR") or "."
        return Path(base)

    def _push(self, src: Path, dest: str, creds: dict[str, Any]) -> str:
        base = self._base(creds)
        target = base / dest
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, target)
        return str(target.relative_to(base))

    def _pull(self, src: str, dest: Path, creds: dict[str, Any]) -> Path:
        base = self._base(creds)
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(base / src, dest)
        return dest

    def _list(self, prefix: str, creds: dict[str, Any]) -> list[str]:
        base = self._base(creds)
        if not base.is_dir():
            return []
        return [
            str(p.relative_to(base))
            for p in sorted(base.rglob("*"))
            if p.is_file() and str(p.relative_to(base)).startswith(prefix)
        ]

    def _delete(self, ref: str, creds: dict[str, Any]) -> None:
        base = self._base(creds)
        (base / ref).unlink(missing_ok=True)


class UrlStorage(StorageBackend):
    """Read-only backend for built-in / public dataset URLs (ADR-044 §4.2
    ``storage.url``). ``pull`` downloads the URL; ``push`` / ``list`` /
    ``delete`` are NOT supported (read-only)."""

    id = "url"
    kind = "url"
    authKey = None
    capabilities = frozenset({CAP_PULL})

    def _pull(self, src: str, dest: Path, creds: dict[str, Any]) -> Path:
        import urllib.request

        dest.parent.mkdir(parents=True, exist_ok=True)
        url = src if src.startswith(("http://", "https://", "file://")) else f"https://{src}"
        urllib.request.urlretrieve(url, str(dest))  # noqa: S310 (user-provided URL)
        return dest


class _CloudStorageBackend(StorageBackend):
    """Base for cloud adapters: require an optional SDK at call time.

    Real SDK wiring (auth flow, upload/download) lands with the cloud-provider
    adapter work (issue #107) / push-job console (#208). Until then the
    adapter is REGISTERED and declares its descriptor, and any operation raises
    a clear, actionable error when the SDK is missing — never a silent no-op.
    """

    _sdk_module = ""
    _install_hint = ""

    def check(self) -> None:
        missing = self._sdk_module and not _importable(self._sdk_module)
        if missing:
            raise StorageBackendError(
                f"storage backend '{self.id}' requires '{self._sdk_module}' "
                f"(install: {self._install_hint})"
            )

    def _push(self, src: Path, dest: str, creds: dict[str, Any]) -> str:
        self._not_wired("push")

    def _pull(self, src: str, dest: Path, creds: dict[str, Any]) -> Path:
        self._not_wired("pull")

    def _list(self, prefix: str, creds: dict[str, Any]) -> list[str]:
        self._not_wired("list")

    def _delete(self, ref: str, creds: dict[str, Any]) -> None:
        self._not_wired("delete")

    def _not_wired(self, op: str) -> None:
        # The SDK import already succeeded (check() passed) — the SDK call
        # itself is a follow-up (#107). Fail loudly, never pretend.
        raise StorageBackendError(
            f"storage backend '{self.id}' {op} is not wired yet — "
            f"cloud SDK calls land with issue #107"
        )


class HuggingFaceStorage(_CloudStorageBackend):
    """Hugging Face dataset repo (push/pull/list/delete on ``user/ds``)."""

    id = "hf"
    kind = "huggingface"
    authKey = "cloud.hf"
    capabilities = ALL_CAPABILITIES
    _sdk_module = "huggingface_hub"
    _install_hint = "uv add huggingface_hub"


class CloudflareR2Storage(_CloudStorageBackend):
    """Cloudflare R2 (S3-compatible) bucket."""

    id = "r2"
    kind = "s3-compatible"
    authKey = "cloud.r2"
    capabilities = ALL_CAPABILITIES
    _sdk_module = "boto3"
    _install_hint = "uv add boto3"


class GoogleDriveStorage(_CloudStorageBackend):
    """Google Drive folder (service account)."""

    id = "gdrive"
    kind = "google-drive"
    authKey = "cloud.gdrive"
    capabilities = ALL_CAPABILITIES
    _sdk_module = "googleapiclient"
    _install_hint = "uv add google-api-python-client google-auth"


def _importable(module_name: str) -> bool:
    import importlib.util

    return importlib.util.find_spec(module_name) is not None


class StorageRegistry:
    """Plugin registry (ADR-033 self-registration).

    ``register`` takes a backend CLASS; ``get`` instantiates it per call so a
    backend can be re-created with fresh state. Unknown ids raise
    ``StorageBackendError`` (never silently fall back).
    """

    def __init__(self) -> None:
        self._classes: dict[str, type[StorageBackend]] = {}

    def register(self, backend: type[StorageBackend]) -> type[StorageBackend]:
        if not backend.id:
            raise StorageBackendError("cannot register a StorageBackend without an id")
        if backend.id in self._classes:
            raise StorageBackendError(f"duplicate storage backend id '{backend.id}'")
        self._classes[backend.id] = backend
        return backend

    def get(self, backend_id: str) -> StorageBackend:
        cls = self._classes.get(backend_id)
        if cls is None:
            raise StorageBackendError(
                f"unknown storage backend '{backend_id}' "
                f"(known: {sorted(self._classes)})"
            )
        return cls()

    def has(self, backend_id: str) -> bool:
        return backend_id in self._classes

    def ids(self) -> list[str]:
        return sorted(self._classes)

    def descriptors(self) -> list[dict[str, Any]]:
        return [self.get(bid).descriptor() for bid in self.ids()]


#: Default registry with the built-in backends (descriptor catalog + runtime).
STORAGE_REGISTRY = StorageRegistry()
STORAGE_REGISTRY.register(BackendDiskStorage)
STORAGE_REGISTRY.register(HuggingFaceStorage)
STORAGE_REGISTRY.register(CloudflareR2Storage)
STORAGE_REGISTRY.register(GoogleDriveStorage)
STORAGE_REGISTRY.register(UrlStorage)
