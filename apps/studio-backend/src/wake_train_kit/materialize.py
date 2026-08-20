"""wake_train_kit.materialize — per-trainer materializers (ADR-044 §6, #206).

The backend twin of the web-side `packages/modules/data/dataset/core/
materialize.ts` (the TypeScript is the source of truth for the
`spec.train.dataset` requirements contract + role→folder maps; this module is
the executor the module train adapters run).

Training params evolve from `dataSource` to **`datasets[]`** refs; the
adapter's `prepare_data` becomes: load refs from the store → materialize →
merge roles (reusing `merge_label_trees` collision rules, #158). The upstream
trainer scripts stay byte-identical (ADR-031) — we only feed them the shape
they already expect.

Per-trainer shape (docs/modules/data-sources.md §6):

| trainer       | materializer produces                                        |
|---------------|--------------------------------------------------------------|
| kws-streaming | a `label/*.wav` tree: positive labels are the wanted words,  |
|               | unknown labels fold into `_unknown_`, noise →                |
|               | `_background_noise_`                                          |
| openwakeword  | a `positives/` wav dir + precomputed mel `.npy` features     |
|               | (unknowns → feature_data_files) + `background/` dirs         |
|               | (noise → background_paths)                                    |

Both validate the picked datasets against `spec.train.dataset` FIRST so the
user gets clear pre-train warnings instead of a cryptic trainer crash.
"""

from __future__ import annotations

import os
import shutil
import struct
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

from .data_sources import DataSourceError
from .dataset_store import DatasetStore

#: The canonical wake-word role name, mirrored from core/spec.ts.
ROLE_POSITIVE = "positive"
ROLE_UNKNOWN = "unknown"
ROLE_NOISE = "noise"


class MaterializeError(RuntimeError):
    """Raised on materializer-level failures (unknown dataset, no positives,
    label collision...). Surfaced as a clear pre-train error, never a trainer
    crash."""


def _log(reporter: Any, level: str, message: str) -> None:
    if reporter is None:
        return
    emit = getattr(reporter, "emit", None)
    if callable(emit):
        emit("log", level=level, message=message)


# ---------------------------------------------------------------------------
# Store access
# ---------------------------------------------------------------------------

def open_dataset_store(datasets_dir: str | Path | None = None) -> DatasetStore:
    """Open the backend `datasets/` store for training-time consumption.

    Resolution order: explicit ``datasets_dir`` → ``DATASETS_DIR`` env →
    the self-hosted layout ``<repo>/data/datasets`` (probed from this file's
    location). The train adapters pass a real path in production; tests pass
    a tmp store directly.
    """
    path = datasets_dir or os.environ.get("DATASETS_DIR")
    if not path:
        here = Path(__file__).resolve()
        repo = here.parents[4]  # .../apps/studio-backend/src/wake_train_kit → repo root
        if (repo / "apps" / "studio-backend").is_dir():
            path = repo / "data" / "datasets"
        else:  # deployed / generic layout
            path = Path("data/datasets")
    return DatasetStore(path)


def extract_dataset(
    store: DatasetStore,
    dataset_id: str,
    dest: Path,
) -> tuple[dict[str, Any], Path]:
    """Extract a stored dataset zip → (manifest, canonical `audio/` clip root).

    The manifest comes from the store index (validated at save time, #204);
    the clip root is `dest/audio/<label>/*.wav` (the canonical layout, ADR-044
    §4.1). Guards against zip-slip member paths.
    """
    record = store.get(dataset_id)
    if record is None:
        raise MaterializeError(
            f"unknown dataset '{dataset_id}' — it is not in the Datasets store "
            f"({store.datasets_dir}); generate or import it first (#205/#208)."
        )
    zip_path = Path(record["stored_path"])
    if not zip_path.is_file():
        raise MaterializeError(f"dataset '{dataset_id}' zip is missing: {zip_path}")
    dest = Path(dest)
    dest.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path) as zf:
        for member in zf.namelist():
            target = (dest / member).resolve()
            if not str(target).startswith(str(dest.resolve())):
                raise MaterializeError(
                    f"dataset '{dataset_id}' zip contains an unsafe path: {member}"
                )
        zf.extractall(dest)
    return record["manifest"], dest / "audio"


def clip_counts(clip_root: Path) -> dict[str, int]:
    """label → wav clip count under a canonical `audio/` root."""
    counts: dict[str, int] = {}
    if not clip_root.is_dir():
        return counts
    for label_dir in clip_root.iterdir():
        if label_dir.is_dir():
            counts[label_dir.name] = len(list(label_dir.glob("*.wav")))
    return counts


# ---------------------------------------------------------------------------
# Requirements validation (mirror of core/materialize.ts)
# ---------------------------------------------------------------------------

@dataclass
class RequirementsValidation:
    ok: bool
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def validate_datasets(
    manifests: list[dict[str, Any]],
    requirements: dict[str, Any] | None = None,
    clips_per_dataset: list[dict[str, int]] | None = None,
) -> RequirementsValidation:
    """Pre-train validation of the picked datasets against `spec.train.dataset`.

    Mirrors `validateDatasetRequirements` in core/materialize.ts. ``manifests``
    are the merged dataset manifests (in pick order); ``clips_per_dataset`` is
    the optional exact per-label clip count per dataset (falls back to the
    manifest's total when absent).
    """
    errors: list[str] = []
    warnings: list[str] = []
    req = requirements or {}
    if not manifests:
        return RequirementsValidation(False, ["Pick at least one dataset."])

    positives: list[dict[str, Any]] = []
    unknowns: list[dict[str, Any]] = []
    noises: list[dict[str, Any]] = []
    all_commercial = True

    for i, manifest in enumerate(manifests):
        labels = manifest.get("labels") or []
        for label in labels:
            if label.get("role") == ROLE_POSITIVE:
                positives.append(label)
            elif label.get("role") == ROLE_UNKNOWN:
                unknowns.append(label)
            elif label.get("role") == ROLE_NOISE:
                noises.append(label)

        rate = (manifest.get("audio") or {}).get("sampleRate")
        if req.get("sampleRate") and rate and rate != req["sampleRate"]:
            errors.append(
                f'"{manifest.get("name")}" is {rate} Hz but this trainer needs '
                f'{req["sampleRate"]} Hz (the canonical dataset form is 16000 Hz; '
                f"resample before use)."
            )

        min_clips = req.get("minClipsPerLabel")
        if min_clips:
            per_label = (clips_per_dataset or [None] * len(manifests))[i]
            label_count = max(1, len(labels))
            total = (manifest.get("audio") or {}).get("clips") or 0
            for label in labels:
                if label.get("role") != ROLE_POSITIVE:
                    continue
                if per_label is not None:
                    count = per_label.get(label.get("name"), 0)
                else:
                    count = total // label_count
                if count < min_clips:
                    warnings.append(
                        f'"{manifest.get("name")}" label "{label.get("name")}" has '
                        f"~{count} clips (this trainer wants >= {min_clips} per wake "
                        f"word; thin labels underfit)."
                    )

        for entry in manifest.get("provenance") or []:
            if entry.get("commercialUse") is False:
                all_commercial = False

    label_mode = req.get("labelMode")
    if label_mode == "single" and len(positives) != 1:
        errors.append(
            "This trainer is single-word (labelMode: single) but the picked "
            f"datasets declare {len(positives)} positive label(s) — pick datasets "
            "with exactly one wake word."
        )
    elif len(positives) < 1:
        errors.append("No positive (wake-word) label found in the picked datasets.")

    if req.get("needsNoise") and not noises:
        errors.append(
            "This trainer needs background noise (`role: noise`) but none of the "
            "picked datasets declares a noise label — add one (it becomes "
            "`_background_noise_` / the background paths)."
        )
    if req.get("needsUnknowns") and not unknowns:
        errors.append(
            "This trainer needs an `_unknown_` / negatives class (`role: unknown`) "
            "but none of the picked datasets declares one — the model cannot "
            "reject non-wake audio."
        )

    if not all_commercial:
        warnings.append(
            "One or more picked datasets is NOT commercially usable "
            "(provenance.commercialUse = false) — the trained model inherits the "
            "restriction (#210)."
        )

    if (
        len(manifests) == 1
        and req.get("needsNoise")
        and req.get("needsUnknowns")
        and positives
        and not unknowns
        and not noises
    ):
        warnings.append(
            "You picked one wake-word-only dataset; training usually also wants "
            "an `unknowns` and a `noise` dataset (mix them in the picker — the "
            "materializer merges roles, #158)."
        )

    return RequirementsValidation(len(errors) == 0, errors, warnings)


# ---------------------------------------------------------------------------
# kws-streaming materializer (label/*.wav tree)
# ---------------------------------------------------------------------------

@dataclass
class KwsStreamingMaterialized:
    data_dir: Path
    wanted_words: str
    sources: list[dict[str, Any]]
    warnings: list[str] = field(default_factory=list)


def _merge_dataset_trees(base: Path, tree: Path, out_dir: Path) -> Path:
    """Merge two per-dataset label trees, mirroring `merge_label_trees` (#158).

    Same collision rules as `data_sources.merge_label_trees`: the base tree is
    copied first and is authoritative; a same-name label folder in the next
    tree is a collision and fails loudly (never silently mixed);
    `_background_noise_` merges with real-noise-wins. Unlike
    ``merge_label_trees`` (whose `_`-prefixed folders in the *negative* tree
    are skipped), every declared label — including the canonical `_unknown`
    label — is preserved and collision-checked, so a second dataset's unknown
    clips are not silently dropped.
    """
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    for src in Path(base).iterdir():
        if src.is_dir():
            shutil.copytree(src, out_dir / src.name, dirs_exist_ok=True)
    for src in Path(tree).iterdir():
        if not src.is_dir():
            continue
        if src.name == "_background_noise_":
            # real noise wins over synthesized silence (mirrors #158)
            shutil.copytree(src, out_dir / "_background_noise_", dirs_exist_ok=True)
            continue
        dst = out_dir / src.name
        if dst.exists():
            raise DataSourceError(
                f"label collision between picked datasets: '{src.name}' exists in "
                "more than one dataset — rename the label in one of them "
                "(collision safety, #158)."
            )
        shutil.copytree(src, dst)
    return out_dir


#: kws-streaming's canonical requirements (mirrors the module spec.train.dataset).
KWS_STREAMING_REQUIREMENTS: dict[str, Any] = {
    "sampleRate": 16000,
    "needsNoise": True,
    "needsUnknowns": True,
    "labelMode": "multi",
}

#: openwakeword's canonical requirements (mirrors the module spec.train.dataset).
OPENWAKEWORD_REQUIREMENTS: dict[str, Any] = {
    "sampleRate": 16000,
    "needsNoise": True,
    "needsUnknowns": True,
    "labelMode": "single",
}


def _materialize_one_tree(
    store: DatasetStore,
    dataset_id: str,
    out_dir: Path,
) -> tuple[dict[str, Any], Path, Path, list[str]]:
    """Turn one dataset into a per-dataset `label/*.wav` tree.

    Role → folder map (core/materialize.ts KWS_STREAMING_MATERIALIZER):
    positive / unknown labels keep their (sanitized) label folder; noise
    labels become `_background_noise_`. Returns
    (manifest, tree_root, clip_root, label_warnings).
    """
    manifest, clip_root = extract_dataset(store, dataset_id, out_dir / "src")
    tree = out_dir / dataset_id
    tree.mkdir(parents=True, exist_ok=True)
    warnings: list[str] = []
    declared = {label["name"]: label for label in (manifest.get("labels") or [])}
    for name, label in declared.items():
        src = clip_root / name
        if not src.is_dir():
            warnings.append(
                f'dataset "{manifest.get("name")}" declares label "{name}" but has '
                f"no clips under audio/{name}/ — skipped."
            )
            continue
        if label.get("role") == ROLE_NOISE:
            dst = tree / "_background_noise_"
        else:
            dst = tree / name
        shutil.copytree(src, dst, dirs_exist_ok=True)
    return manifest, tree, clip_root, warnings


def materialize_kws_streaming(
    store: DatasetStore,
    dataset_ids: list[str],
    out_dir: Path | str,
    reporter: Any = None,
    requirements: dict[str, Any] | None = None,
) -> KwsStreamingMaterialized:
    """Materialize `datasets[]` into ONE kws-streaming `label/*.wav` tree.

    Steps: extract each dataset → per-dataset role→folder tree → merge across
    datasets with `merge_label_trees` (#158 collision rules: the first tree is
    authoritative; a same-name label in another dataset is a collision and
    fails loudly; real `_background_noise_` wins over synthesized silence).

    Returns the merged data root, the comma-joined wanted words (the positive
    labels), the merged provenance (license-gate input, #210) and any
    warnings.
    """
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    manifests: list[dict[str, Any]] = []
    trees: list[Path] = []
    sources: list[dict[str, Any]] = []
    warnings: list[str] = []

    for i, dataset_id in enumerate(dataset_ids):
        _log(reporter, "info", f"materialize kws-streaming: {dataset_id}")
        manifest, tree, _clip_root, label_warnings = _materialize_one_tree(
            store, dataset_id, out / "trees"
        )
        manifests.append(manifest)
        trees.append(tree)
        sources.extend(manifest.get("provenance") or [])
        warnings.extend(label_warnings)

    # Validate the combined dataset set against the trainer's requirements.
    validation = validate_datasets(manifests, requirements or KWS_STREAMING_REQUIREMENTS)
    warnings.extend(validation.warnings)
    if not validation.ok:
        raise MaterializeError(
            "picked datasets do not satisfy the kws-streaming train requirements: "
            + "; ".join(validation.errors)
        )

    # Merge: the first tree is the authoritative base; each further tree is
    # merged with the #158 collision rules (dataset-aware, preserves `_unknown`).
    merged = trees[0]
    for i, tree in enumerate(trees[1:], start=1):
        _log(reporter, "info", f"merging dataset tree {i + 1} into the data root")
        merged = _merge_dataset_trees(merged, tree, out / f"merged_{i}")

    wanted: list[str] = []
    for manifest in manifests:
        for label in manifest.get("labels") or []:
            if label.get("role") == ROLE_POSITIVE and label["name"] not in wanted:
                wanted.append(label["name"])

    if not wanted:
        raise MaterializeError(
            "the picked datasets contain no positive (wake-word) label — nothing "
            "to train as the wake word."
        )

    return KwsStreamingMaterialized(
        data_dir=merged,
        wanted_words=",".join(wanted),
        sources=sources,
        warnings=warnings,
    )


# ---------------------------------------------------------------------------
# openwakeword materializer (positives dir + features + background)
# ---------------------------------------------------------------------------

@dataclass
class OpenWakeWordMaterialized:
    materialized_dir: Path
    positives_dir: Path
    features_dir: Path
    background_dir: Path | None
    target_phrase: list[str]
    background_paths: list[str]
    feature_data_files: dict[str, str]
    sources: list[dict[str, Any]]
    warnings: list[str] = field(default_factory=list)


#: A numpy array duck-type: anything with `.shape`, `.dtype` and `.tobytes()`.
FeatureArray = Any


def _minimal_npy(path: Path, arr: FeatureArray) -> None:
    """Serialize a float32 2-D array to the .npy format without numpy.

    Matches ``np.save`` for the common C-order float32 case (openWakeWord mel
    features). Accepts any object with ``.shape`` / ``.dtype`` / ``.tobytes()``
    so tests run without numpy installed.
    """
    shape = tuple(int(s) for s in arr.shape)
    dtype = str(arr.dtype)
    if dtype not in ("<f4", "float32", "float32_"):
        raise MaterializeError(
            f"openwakeword feature extractor returned dtype {dtype}; expected "
            "float32 for the canonical mel .npy."
        )
    rows = ", ".join(str(s) for s in shape)
    shape_str = f"({rows},)" if len(shape) == 1 else f"({rows})"
    header = f"{{'descr': '<f4', 'fortran_order': False, 'shape': {shape_str}, }}"
    pad = 64 - (10 + len(header)) % 64
    if pad < 0:
        pad += 64
    header = header + " " * (pad + 1)
    with open(path, "wb") as f:
        f.write(b"\x93NUMPY")
        f.write(struct.pack("<H", 1))
        f.write(struct.pack("<H", len(header)))
        f.write(header.encode("ascii"))
        f.write(arr.tobytes())


def _default_openwakeword_extractor(wav_path: Path) -> FeatureArray:
    """The upstream openWakeWord mel feature extractor (lazy import)."""
    try:
        from openwakeword.feature_extractor import get_mel_spectrogram
    except ImportError as exc:  # pragma: no cover - depends on the upstream env
        raise MaterializeError(
            "openwakeword feature extractor is not importable; run the "
            "openwakeword train adapter under an env with openwakeword "
            "(module train extra / UPSTREAM_PYTHON)"
        ) from exc
    return get_mel_spectrogram(str(wav_path), model_sampling_rate=16000)


def materialize_openwakeword(
    store: DatasetStore,
    dataset_ids: list[str],
    out_dir: Path | str,
    feature_extractor: Callable[[Path], FeatureArray] | None = None,
    reporter: Any = None,
    requirements: dict[str, Any] | None = None,
) -> OpenWakeWordMaterialized:
    """Materialize `datasets[]` into the openwakeword shape.

    Produces (docs/modules/data-sources.md §6 / core/materialize.ts):

    - ``positives/`` — every `role: positive` clip (a wav pool for the wake word)
    - ``features/<label>.npy`` — `role: unknown` clips run through the feature
      extractor (feature_data_files, the negatives class)
    - ``background/`` — every `role: noise` clip (→ background_paths)

    ``feature_extractor`` is injectable so tests use a fake upstream; the
    default is openWakeWord's own mel extractor. Returns the materialized dir
    plus the config overrides the adapter feeds into the (byte-identical)
    upstream `custom_model.yml`.
    """
    out = Path(out_dir)
    positives = out / "positives"
    features = out / "features"
    background = out / "background"
    positives.mkdir(parents=True, exist_ok=True)
    features.mkdir(parents=True, exist_ok=True)
    background.mkdir(parents=True, exist_ok=True)

    extractor = feature_extractor or _default_openwakeword_extractor
    manifests: list[dict[str, Any]] = []
    sources: list[dict[str, Any]] = []
    warnings: list[str] = []
    positive_labels: list[str] = []
    unknown_features: dict[str, list[Path]] = {}
    has_noise = False

    for dataset_id in dataset_ids:
        _log(reporter, "info", f"materialize openwakeword: {dataset_id}")
        manifest, clip_root = extract_dataset(store, dataset_id, out / "src")
        manifests.append(manifest)
        sources.extend(manifest.get("provenance") or [])
        for label in manifest.get("labels") or []:
            label_dir = clip_root / label["name"]
            if not label_dir.is_dir():
                warnings.append(
                    f'dataset "{manifest.get("name")}" declares label '
                    f'"{label["name"]}" but has no clips — skipped.'
                )
                continue
            role = label.get("role")
            if role == ROLE_POSITIVE:
                if label["name"] not in positive_labels:
                    positive_labels.append(label["name"])
                for wav in sorted(label_dir.glob("*.wav")):
                    shutil.copy(wav, positives / f"{dataset_id}_{label['name']}_{wav.name}")
            elif role == ROLE_UNKNOWN:
                unknown_features.setdefault(label["name"], []).extend(
                    sorted(label_dir.glob("*.wav"))
                )
            elif role == ROLE_NOISE:
                has_noise = True
                for wav in sorted(label_dir.glob("*.wav")):
                    shutil.copy(wav, background / wav.name)

    validation = validate_datasets(manifests, requirements or OPENWAKEWORD_REQUIREMENTS)
    warnings.extend(validation.warnings)
    if not validation.ok:
        raise MaterializeError(
            "picked datasets do not satisfy the openwakeword train requirements: "
            + "; ".join(validation.errors)
        )

    feature_data_files: dict[str, str] = {}
    for label, wavs in unknown_features.items():
        if not wavs:
            continue
        npy = features / f"{label}.npy"
        stacks = [extractor(wav) for wav in wavs]
        if len(stacks) == 1:
            arr = stacks[0]
        else:
            # stack frames of equal-shape features into one .npy
            arr = _stack_features(stacks)
        _minimal_npy(npy, arr)
        feature_data_files[label] = str(npy)

    background_paths = [str(background)] if has_noise else []

    if not positive_labels:
        raise MaterializeError(
            "the picked datasets contain no positive (wake-word) label — nothing "
            "to train as the wake word."
        )

    return OpenWakeWordMaterialized(
        materialized_dir=out,
        positives_dir=positives,
        features_dir=features,
        background_dir=background if has_noise else None,
        target_phrase=positive_labels,
        background_paths=background_paths,
        feature_data_files=feature_data_files,
        sources=sources,
        warnings=warnings,
    )


def _stack_features(stacks: list[FeatureArray]) -> FeatureArray:
    """Stack same-shape feature arrays along a new leading axis (np.stack).

    Implemented with the duck-typed contract only (shape/dtype/tobytes) so it
    runs without numpy; returns a plain adapter object the npy writer accepts.
    """
    first = stacks[0]
    dtype = first.dtype
    shape = (len(stacks),) + tuple(int(s) for s in first.shape)
    if not all(tuple(int(s) for s in a.shape) == tuple(int(s) for s in first.shape) for a in stacks):
        raise MaterializeError(
            "cannot stack unknown-label features of differing shapes; expected "
            "equal-length clips for one `role: unknown` label."
        )
    payload = b"".join(bytes(a.tobytes()) for a in stacks)
    return _StackedArray(shape=shape, dtype=dtype, payload=payload)


class _StackedArray:
    """Minimal numpy-array duck-type for stacking features without numpy."""

    __slots__ = ("shape", "dtype", "_payload")

    def __init__(self, shape, dtype, payload: bytes) -> None:
        self.shape = shape
        self.dtype = dtype
        self._payload = payload

    def tobytes(self) -> bytes:
        return self._payload
