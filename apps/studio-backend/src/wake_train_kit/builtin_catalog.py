"""wake_train_kit.builtin_catalog — built-in dataset catalog (ADR-044 §7, #207).

Mirror of the web-side `packages/modules/data/dataset/core/catalog.ts` + the
curated `catalog/builtins.json` (the TypeScript types are the source of truth;
this module is the backend loader + materialize-on-first-use executor).

Built-ins are IMMUTABLE references (`kind: builtin`): the manifest (labels,
roles, license + `commercialUse` provenance) is known, but the canonical
`wake-studio-dataset.zip` is only produced on first use. `ensure_builtin`
materializes a built-in into the `datasets/` store (survives restarts, #204)
so a picked built-in id works anywhere a generated/uploaded dataset id does
(the wizard picker, the train adapters' load-refs → materialize → merge, #206).

Materialize types (core/catalog.ts `BuiltinMaterialize`):

- ``speech-commands-v2`` — convert the Google SC2 archive via the existing
  data-source helper (ADR-022, #152) into a canonical zip (fully wired today).
- ``canonical-zip`` — fetch a pre-built canonical zip URL and import it.
- ``pending-host`` — declared (license/provenance known) but no hosted zip
  yet; not trainable, raises a clear error.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from .data_sources import download_file, prepare_speech_commands_v2
from .dataset import pack_dataset_zip
from .dataset_store import DatasetStore
from .materialize import MaterializeError

CATALOG_SOURCE = "packages/modules/data/dataset/catalog/builtins.json"
#: wheel-packaged copy (pyproject force-include) for deployed/generic layouts.
PACKAGED_CATALOG = "builtin_catalog.json"


class BuiltinCatalogError(MaterializeError):
    """Raised when a built-in id is unknown or not yet hostable.

    Subclasses `materialize.MaterializeError` so the train adapters surface it
    as a clear pre-train error (never a cryptic trainer crash)."""


def _catalog_path() -> Path:
    """Locate the curated catalog: env override → repo file → packaged copy."""
    env = os.environ.get("BUILTIN_CATALOG")
    if env:
        return Path(env)
    here = Path(__file__).resolve()
    repo = here.parents[4]  # .../apps/studio-backend/src/wake_train_kit → repo root
    repo_file = repo / CATALOG_SOURCE
    if repo_file.is_file():
        return repo_file
    packaged = here.parent / PACKAGED_CATALOG
    if packaged.is_file():
        return packaged
    raise BuiltinCatalogError(
        "built-in catalog not found (set BUILTIN_CATALOG or ship the packaged "
        f"{PACKAGED_CATALOG})"
    )


def load_catalog() -> list[dict[str, Any]]:
    """Load + validate the built-in catalog entries (list of manifests)."""
    import json

    raw = json.loads(_catalog_path().read_text(encoding="utf-8"))
    datasets = raw.get("datasets") or []
    for entry in datasets:
        if entry.get("kind") != "builtin":
            raise BuiltinCatalogError(
                f"built-in catalog entry '{entry.get('id')}' must be kind=builtin"
            )
        if not entry.get("materialize"):
            raise BuiltinCatalogError(
                f"built-in catalog entry '{entry.get('id')}' needs a materialize descriptor"
            )
    return datasets


def entry(dataset_id: str) -> dict[str, Any] | None:
    """The catalog entry for a built-in id (None when it is not a built-in)."""
    return next((e for e in load_catalog() if e.get("id") == dataset_id), None)


def is_builtin(dataset_id: str) -> bool:
    return entry(dataset_id) is not None


def _build_manifest(entry: dict[str, Any], clip_counts: dict[str, int], total: int) -> dict[str, Any]:
    """Stored manifest for a materialized built-in: the entry minus
    `materialize`, with the audio stats reflecting the real tree."""
    manifest = {k: v for k, v in entry.items() if k != "materialize"}
    audio = dict(manifest.get("audio") or {})
    audio["clips"] = total
    manifest["audio"] = audio
    manifest["contentHash"] = None  # pack_dataset_zip recomputes it
    return manifest


def ensure_builtin(
    store: DatasetStore,
    dataset_id: str,
    work_dir: Path | str,
    reporter: Any = None,
) -> dict[str, Any]:
    """Materialize a built-in on first use and return its stored manifest.

    Idempotent: if the built-in is already in the store it is returned
    unchanged (immutable reference — a second materialize is a no-op).
    """
    existing = store.get(dataset_id)
    if existing is not None:
        return existing["manifest"]

    catalog_entry = entry(dataset_id)
    if catalog_entry is None:
        raise BuiltinCatalogError(
            f"unknown dataset '{dataset_id}' — it is not in the Datasets store and "
            "not a built-in (check the catalog / generate or import it first)."
        )

    work = Path(work_dir)
    work.mkdir(parents=True, exist_ok=True)
    materialize = catalog_entry.get("materialize") or {}
    mtype = materialize.get("type")

    if mtype == "speech-commands-v2":
        root, prov = prepare_speech_commands_v2(work / "sc2", reporter)
        counts, total = _count_wavs(root)
        manifest = _build_manifest(catalog_entry, counts, total)
        manifest["provenance"] = [prov]
        zip_path = pack_dataset_zip(root, manifest, work / f"{dataset_id}.zip")
        store.save(zip_path)
    elif mtype == "canonical-zip":
        url = materialize.get("url", "")
        if not url:
            raise BuiltinCatalogError(
                f"built-in '{dataset_id}' is canonical-zip but has no url"
            )
        zip_path = download_file(url, work / f"{dataset_id}.zip", reporter)
        store.save(zip_path)
    else:
        note = materialize.get("note") or ""
        raise BuiltinCatalogError(
            f"built-in dataset '{dataset_id}' is declared but not yet hosted "
            f"(materialize.type='{mtype}'). {note}".strip()
        )

    stored = store.get(dataset_id)
    if stored is None:  # pragma: no cover - store.save always registers
        raise BuiltinCatalogError(f"built-in '{dataset_id}' did not persist to the store")
    return stored["manifest"]


def _count_wavs(data_root: Path) -> tuple[dict[str, int], int]:
    """label → clip count over a `label/*.wav` tree + the total."""
    counts: dict[str, int] = {}
    total = 0
    for label_dir in data_root.iterdir():
        if label_dir.is_dir():
            n = len(list(label_dir.glob("*.wav")))
            counts[label_dir.name] = n
            total += n
    return counts, total
