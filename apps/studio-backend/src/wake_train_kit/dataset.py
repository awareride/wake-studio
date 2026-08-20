"""wake_train_kit.dataset — the dataset.json manifest contract + importer (ADR-044, #203).

Mirror of the web-side `packages/modules/data/dataset/core/spec.ts` + `manifest.ts`
so the SAME `wake-studio-dataset.zip` validates identically in the browser and in
the studio-backend. The TypeScript types are the source of truth; this module is
the backend validation/import path (used by the dataset store, generation jobs
and materializers — tasks #204/#205/#206).

Canonical layout (docs/modules/data-sources.md §4.1)::

    wake-studio-dataset.zip
    ├── dataset.json          <-- the portability contract
    └── audio/<label>/*.wav   <-- 16 kHz mono PCM WAV, canonical
"""

from __future__ import annotations

import hashlib
import json
import re
import zipfile
from pathlib import Path
from typing import Any, TypedDict

DATASET_MANIFEST_SCHEMA_VERSION = 1
CANONICAL_SAMPLE_RATE = 16000
CANONICAL_ENCODING = "pcm_s16le"

DATASET_KINDS = ("builtin", "generated", "uploaded", "public")
DATASET_ROLES = ("positive", "unknowns", "noise", "mixed")
LABEL_ROLES = ("positive", "unknown", "noise")


class DatasetLabel(TypedDict):
    name: str
    role: str
    language: str | None
    source: str | None  # "real" | "synthetic"
    voices: list[str] | None


class DatasetAudio(TypedDict):
    sampleRate: int
    channels: int
    encoding: str
    clips: int
    durationSec: int


class DatasetProvenanceEntry(TypedDict):
    name: str
    license: str
    commercialUse: bool
    source: str | None


class DatasetManifest(TypedDict):
    schemaVersion: int
    id: str
    name: str
    version: int
    kind: str
    role: str
    audio: DatasetAudio
    labels: list[DatasetLabel]
    provenance: list[DatasetProvenanceEntry]
    recipe: dict[str, Any] | None
    contentHash: str | None
    storage: dict[str, Any] | None
    createdAtMs: int | None


def _is_nonempty_str(v: Any) -> bool:
    return isinstance(v, str) and bool(v.strip())


def _is_plain_record(v: Any) -> bool:
    return isinstance(v, dict)


def validate_dataset_manifest(raw: Any) -> tuple[bool, list[str]]:
    """Validate a parsed ``dataset.json`` against the manifest contract (ADR-044).

    Mirrors `validateDatasetManifest` in the web module. Returns
    ``(ok, errors)``; callers decide how to surface the errors.
    """
    errors: list[str] = []
    if not _is_plain_record(raw):
        return False, ["dataset.json must be a JSON object"]

    m: dict[str, Any] = raw

    if m.get("schemaVersion") != DATASET_MANIFEST_SCHEMA_VERSION:
        errors.append(
            f"schemaVersion must be {DATASET_MANIFEST_SCHEMA_VERSION} "
            f"(got {m.get('schemaVersion')})"
        )
    if not _is_nonempty_str(m.get("id")):
        errors.append("id must be a non-empty string")
    if not _is_nonempty_str(m.get("name")):
        errors.append("name must be a non-empty string")
    version = m.get("version")
    if not isinstance(version, int) or version < 1:
        errors.append("version must be an integer >= 1")
    if m.get("kind") not in DATASET_KINDS:
        errors.append(f"kind must be one of: {', '.join(DATASET_KINDS)}")
    if m.get("role") not in DATASET_ROLES:
        errors.append(f"role must be one of: {', '.join(DATASET_ROLES)}")

    audio = m.get("audio")
    if not _is_plain_record(audio):
        errors.append("audio must be an object")
    else:
        if not isinstance(audio.get("sampleRate"), int) or audio["sampleRate"] <= 0:
            errors.append("audio.sampleRate must be a positive number")
        if not isinstance(audio.get("channels"), int) or audio["channels"] <= 0:
            errors.append("audio.channels must be a positive number")
        if audio.get("encoding") != CANONICAL_ENCODING:
            errors.append(
                f'audio.encoding must be "{CANONICAL_ENCODING}" in the canonical form '
                "(derived formats are materialized, not stored)"
            )
        if not isinstance(audio.get("clips"), int) or audio["clips"] < 0:
            errors.append("audio.clips must be a number >= 0")
        if not isinstance(audio.get("durationSec"), (int, float)) or audio["durationSec"] < 0:
            errors.append("audio.durationSec must be a number >= 0")

    labels = m.get("labels")
    if not isinstance(labels, list) or len(labels) == 0:
        errors.append("labels must be a non-empty array")
    else:
        seen: set[str] = set()
        for i, label in enumerate(labels):
            if not _is_plain_record(label):
                errors.append(f"labels[{i}] must be an object")
                continue
            name = label.get("name")
            if not _is_nonempty_str(name):
                errors.append(f"labels[{i}].name must be a non-empty string")
            elif name in seen:
                errors.append(f'labels[{i}].name duplicates "{name}"')
            seen.add(str(name or ""))
            if label.get("role") not in LABEL_ROLES:
                errors.append(f"labels[{i}].role must be one of: {', '.join(LABEL_ROLES)}")

    provenance = m.get("provenance")
    if not isinstance(provenance, list) or len(provenance) == 0:
        errors.append("provenance must be a non-empty array")
    else:
        for i, entry in enumerate(provenance):
            if not _is_plain_record(entry):
                errors.append(f"provenance[{i}] must be an object")
                continue
            if not _is_nonempty_str(entry.get("name")):
                errors.append(f"provenance[{i}].name must be a non-empty string")
            if not _is_nonempty_str(entry.get("license")):
                errors.append(f"provenance[{i}].license must be a non-empty string")
            if not isinstance(entry.get("commercialUse"), bool):
                errors.append(f"provenance[{i}].commercialUse must be a boolean")

    if m.get("contentHash") is not None and not _is_nonempty_str(m.get("contentHash")):
        errors.append("contentHash, when present, must be a non-empty string")

    return len(errors) == 0, errors


def load_dataset_manifest(manifest_path: Path | str) -> DatasetManifest:
    """Read + validate a ``dataset.json`` from disk.

    Raises ``ValueError`` (with the validation errors) when invalid.
    """
    path = Path(manifest_path)
    data: Any = json.loads(path.read_text(encoding="utf-8"))
    ok, errors = validate_dataset_manifest(data)
    if not ok:
        raise ValueError("invalid dataset.json: " + "; ".join(errors))
    return data  # type: ignore[return-value]


def dataset_content_hash(manifest: DatasetManifest, clips: dict[str, list[tuple[str, bytes]]]) -> str:
    """sha256 over the canonical payload — manifest (minus hash/storage) + clip bytes.

    Byte-identical to the web `datasetContentHash` (core/hash.ts): the same
    manifest + clips hash to the same value in both worlds, so a dataset
    persisted by the backend imports + verifies in the browser and vice versa.
    Layout: ``dataset.json\\n`` + sorted-key JSON (`,``/`:` separators, raw
    UTF-8) + ``\\n`` + for each sorted label, each clip sorted by name:
    ``audio/<label>/<name>\\n`` + bytes + ``\\n``.
    """
    content = {k: v for k, v in manifest.items() if k not in ("contentHash", "storage")}
    canonical = json.dumps(
        content, sort_keys=True, ensure_ascii=False, separators=(",", ":")
    )
    digest = hashlib.sha256()
    digest.update("dataset.json\n".encode("utf-8"))
    digest.update(canonical.encode("utf-8"))
    digest.update(b"\n")
    for label in sorted(clips):
        for name, bytes_ in sorted(clips[label], key=lambda c: c[0]):
            digest.update(f"audio/{label}/{name}\n".encode("utf-8"))
            digest.update(bytes_)
            digest.update(b"\n")
    return digest.hexdigest()


def import_dataset_zip(zip_path: Path | str) -> tuple[DatasetManifest, dict[str, list[str]]]:
    """Import a ``wake-studio-dataset.zip`` -> (manifest, label -> clip names).

    Validates ``dataset.json`` and indexes the canonical ``audio/<label>/*.wav``
    tree. Every declared label must have >= 1 clip. Raises ``ValueError`` with a
    stable, human-readable message on any invalid/missing part.
    """
    path = Path(zip_path)
    with zipfile.ZipFile(path) as zf:
        names = zf.namelist()
        if not names:
            raise ValueError("empty zip: expected dataset.json and an audio/ tree")

        manifest_bytes = next(
            (zf.read(n) for n in names if n.split("/")[-1] == "dataset.json"), None
        )
        if manifest_bytes is None:
            raise ValueError("dataset.json is missing from the zip")

        try:
            parsed: Any = json.loads(manifest_bytes.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise ValueError(f"dataset.json is invalid JSON: {exc}") from exc

        ok, errors = validate_dataset_manifest(parsed)
        if not ok:
            raise ValueError("invalid dataset.json: " + "; ".join(errors))
        manifest: DatasetManifest = parsed  # type: ignore[assignment]

        clips: dict[str, list[str]] = {}
        clip_matcher = re.compile(r"^audio/([^/]+)/([^/]+)$")
        for name in names:
            match = clip_matcher.match(name)
            if not match or not name.lower().endswith(".wav"):
                continue
            clips.setdefault(match.group(1), []).append(match.group(2))

        missing = [label["name"] for label in manifest["labels"] if not clips.get(label["name"])]
        if missing:
            raise ValueError(
                "every declared label must have >= 1 clip; empty labels: "
                + ", ".join(missing)
            )

        return manifest, clips


def pack_dataset_zip(
    data_root: Path | str,
    manifest: DatasetManifest,
    out_zip: Path | str,
) -> Path:
    """Write the canonical ``wake-studio-dataset.zip`` (manifest + audio tree).

    ``data_root`` holds ``<label>/<clip>.wav`` folders; the zip layout is
    ``dataset.json`` at the root + ``audio/<label>/<clip>.wav`` entries (the
    layout the importer expects, ADR-044 §4.1). The manifest's ``contentHash``
    is (re)computed over the canonical payload before writing.
    """
    root = Path(data_root)
    out = Path(out_zip)
    out.parent.mkdir(parents=True, exist_ok=True)

    clips: dict[str, list[tuple[str, bytes]]] = {}
    for label_dir in sorted(p for p in root.iterdir() if p.is_dir()):
        for wav in sorted(label_dir.glob("*.wav")):
            clips.setdefault(label_dir.name, []).append((wav.name, wav.read_bytes()))

    manifest = dict(manifest)  # copy; never mutate the caller's manifest
    manifest["contentHash"] = dataset_content_hash(manifest, clips)

    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("dataset.json", json.dumps(manifest, ensure_ascii=False))
        for label, clip_list in clips.items():
            for name, bytes_ in clip_list:
                zf.writestr(f"audio/{label}/{name}", bytes_)
    return out
