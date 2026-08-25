"""wake_train_kit.generation — dataset generation pipeline (ADR-044 §5, #205).

One pipeline everywhere::

    collect -> synthesize -> postprocess -> assemble -> persist

TTS engines are pluggable, MODULE-OWNED adapters (ADR-033 self-registration):
each `data`-category engine module (`packages/modules/data/<engine>/`) owns its
`adapter.py` — the module's `spec.tts` is the contract, the module owns its
code, like kws train adapters. This host module dispatches to the requested
engine's adapter at runtime (importlib, resolved from the engine module root)
and runs the shared postprocess + canonical-assemble stages.

Engine adapter contract (implemented by each module's `adapter.py`):

    class Engine:
        id = "edge-tts"            # == spec.meta.id
        kind = "classic-tts"       # classic-tts | online-http-tts | llm-tts
        def synthesize(self, params, out_dir, reporter) -> dict:
            # writes a canonical label/*.wav tree into out_dir; returns
            # {"provenance": {...}, "labels": [{name, role, ...}]}
"""

from __future__ import annotations

import importlib.util
import os
import time
import uuid
from pathlib import Path
from typing import Any

from .data_sources import DataSourceError
from .dataset import pack_dataset_zip
from .http_tts import GenerationError
from .postprocess import apply_postprocess

# Engine modules root: packages/modules/data (repo layout). Overridable via
# WAKE_ENGINE_MODULES for deployed/generic-runtime layouts.
_DEFAULT_ENGINE_ROOT = Path(__file__).resolve().parents[4] / "packages" / "modules" / "data"


def engine_modules_root() -> Path:
    return Path(os.environ.get("WAKE_ENGINE_MODULES") or _DEFAULT_ENGINE_ROOT)


def load_engine(engine_id: str, **ctor_kwargs: Any) -> Any:
    """Load an engine's module-owned adapter (packages/modules/data/<id>/adapter.py).

    Returns an instantiated engine object with ``id`` / ``kind`` /
    ``synthesize(params, out_dir, reporter)``. ``ctor_kwargs`` are passed to
    the Engine constructor (e.g. ``post_json`` for test injection). Raises
    GenerationError when the engine is unknown or its adapter is missing.
    """
    root = engine_modules_root()
    adapter_path = root / engine_id / "adapter.py"
    if not adapter_path.is_file():
        raise GenerationError(
            f"unknown TTS engine '{engine_id}' (no adapter at {adapter_path}; "
            f"known engines live in packages/modules/data/*/adapter.py)"
        )
    module_name = f"wake_engine_{engine_id.replace('-', '_')}"
    spec = importlib.util.spec_from_file_location(module_name, adapter_path)
    if spec is None or spec.loader is None:
        raise GenerationError(f"cannot load engine adapter '{engine_id}'")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    engine_cls = getattr(module, "Engine", None)
    if engine_cls is None:
        raise GenerationError(f"engine adapter '{engine_id}' has no 'Engine' class")
    return engine_cls(**ctor_kwargs)


def _as_list(value: Any) -> list[str]:
    import re

    if value is None:
        return []
    if isinstance(value, str):
        return [v.strip() for v in re.split(r"[,;]", value) if v.strip()]
    if isinstance(value, (list, tuple)):
        return [str(v) for v in value]
    return []


def _emit_log(reporter: Any, level: str, message: str) -> None:
    if reporter is not None and hasattr(reporter, "emit"):
        reporter.emit("log", level=level, message=message)
    elif reporter is not None and hasattr(reporter, "log"):
        reporter.log(level=level, message=message)


def build_manifest(
    params: dict[str, Any],
    audio_root: Path,
    provenance: dict[str, Any],
    labels: list[dict[str, Any]],
    tool_versions: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Assemble the ``dataset.json`` manifest for a generated dataset.

    Reproducibility (#209): ``recipe.seed`` (from params) + ``recipe.toolVersions``
    (engine toolchain, e.g. edge-tts version) make "regenerate" byte-reproducible
    — same params + same tool versions → same ``contentHash``.
    """
    clips = 0
    for label_dir in audio_root.iterdir():
        if label_dir.is_dir():
            clips += len(list(label_dir.glob("*.wav")))

    phrases = _as_list(params.get("phrases", []))
    languages = _as_list(params.get("languages", ["en-US"]))
    name = params.get("name") or (f"{_sanitize_label(phrases[0])}-{' '.join(languages)}" if phrases else "generated")
    dataset_id = params.get("datasetId") or str(uuid.uuid4())

    return {
        "schemaVersion": 1,
        "id": dataset_id,
        "name": name,
        "version": 1,
        "kind": "generated",
        "role": "mixed",
        "audio": {
            "sampleRate": 16000,
            "channels": 1,
            "encoding": "pcm_s16le",
            "clips": clips,
            "durationSec": 0,
        },
        "labels": labels,
        "provenance": [provenance],
        "recipe": {
            "engine": params.get("engine") or "edge-tts",
            "phrases": phrases,
            "languages": languages,
            "seed": int(params.get("seed") or 0),
            "toolVersions": dict(tool_versions or {}),
        },
        "storage": {"backend": f"datasets/{dataset_id}/"},
        "createdAtMs": int(time.time() * 1000),
    }


def _sanitize_label(text: str) -> str:
    import re

    cleaned = re.sub(r"[^0-9a-zA-Z_-]+", "_", text.strip().lower())
    return cleaned or "word"


def generate_dataset(
    params: dict[str, Any],
    work_dir: Path | str,
    reporter: Any = None,
) -> Path:
    """Run the generation pipeline -> canonical ``wake-studio-dataset.zip``.

    Stages (emitted as NDJSON progress): synthesize -> postprocess -> assemble.
    The engine adapter is loaded from its module (packages/modules/data/<id>/).
    The returned zip is the artifact the job manager registers (GET /artifacts).
    """
    work = Path(work_dir)
    audio_root = work / "audio"
    audio_root.mkdir(parents=True, exist_ok=True)

    engine_id = params.get("engine") or "edge-tts"
    engine = load_engine(engine_id)

    _emit_log(reporter, "info", f"dataset-generate: engine={engine_id}")
    if reporter is not None and hasattr(reporter, "progress"):
        reporter.progress(step=1, total=3, progress=1 / 3, message="synthesize")

    result = engine.synthesize(params, audio_root, reporter)
    provenance = result["provenance"]
    labels = result["labels"]

    if reporter is not None and hasattr(reporter, "progress"):
        reporter.progress(step=2, total=3, progress=2 / 3, message="postprocess")
    apply_postprocess(params.get("postprocess") or "passthrough", audio_root, reporter)

    if reporter is not None and hasattr(reporter, "progress"):
        reporter.progress(step=3, total=3, progress=1.0, message="assemble")
    manifest = build_manifest(
        params,
        audio_root,
        provenance,
        labels,
        tool_versions=result.get("toolVersions"),
    )
    zip_path = pack_dataset_zip(audio_root, manifest, work / "wake-studio-dataset.zip")
    return zip_path
