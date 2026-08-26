"""wake_train_kit.generation_runner — dataset-generate job entry (ADR-044 §5, #205).

Registry entry (engine "direct") for the studio-backend job manager (ADR-036).
Reads job params from GEN_* env vars + WAKE_PARAMS JSON (the registry
convention), runs the generation pipeline, and emits the NDJSON reporting
protocol on stdout: ``progress`` (synthesize/postprocess/assemble), ``log``,
``artifact`` (the canonical wake-studio-dataset.zip) and ``done``.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any

from wake_train_kit.generation import generate_dataset

try:
    from wake_train_kit.report import Reporter
except ImportError:  # standalone fallback: plain NDJSON prints
    class Reporter:  # type: ignore[no-redef]
        def emit(self, event: str, **fields: Any) -> None:
            print(json.dumps({"event": event, **fields}), flush=True)


DEFAULTS: dict[str, Any] = {
    "engine": "edge-tts",
    "phrases": "",
    "languages": "en-US",
    "samplesPerPhrase": 3,
    "unknownWords": "goodbye,okay,stop,hello,thanks",
    "postprocess": "passthrough",
    "endpoint": "https://api.xiaomimimo.com/v1",
    "apiKey": "",
    "model": "mimo-v2.5-tts",
    "voice": "",
    "styleInstruction": "",
    "sampleRate": 16000,
    "name": "",
    "datasetId": "",
    "seed": "0",
}

ENV_MAP: dict[str, str] = {
    "GEN_ENGINE": "engine",
    "GEN_PHRASES": "phrases",
    "GEN_LANGUAGES": "languages",
    "GEN_SAMPLES": "samplesPerPhrase",
    "GEN_UNKNOWN_WORDS": "unknownWords",
    "GEN_POSTPROCESS": "postprocess",
    "GEN_ENDPOINT": "endpoint",
    "GEN_API_KEY": "apiKey",
    "GEN_MODEL": "model",
    "GEN_VOICE": "voice",
    "GEN_STYLE": "styleInstruction",
    "GEN_SAMPLE_RATE": "sampleRate",
    "GEN_NAME": "name",
    "GEN_DATASET_ID": "datasetId",
    "GEN_SEED": "seed",
}


def _coerce(value: str, default: Any) -> Any:
    if isinstance(default, int):
        try:
            return int(value)
        except (TypeError, ValueError):
            return default
    return value


def read_params(env: dict[str, str] | None = None) -> dict[str, Any]:
    """Job params from GEN_* env vars + WAKE_PARAMS JSON (both conventions)."""
    env = env if env is not None else os.environ
    params: dict[str, Any] = dict(DEFAULTS)

    raw_json = env.get("WAKE_PARAMS", "")
    if raw_json:
        try:
            for key, value in json.loads(raw_json).items():
                if key in DEFAULTS:
                    params[key] = _coerce(str(value), DEFAULTS[key])
        except (ValueError, TypeError):
            pass

    for var, key in ENV_MAP.items():
        raw = env.get(var, "")
        if raw != "":
            params[key] = _coerce(raw, DEFAULTS[key])
    return params


def main(argv: list[str] | None = None) -> int:
    reporter = Reporter()
    params = read_params()
    work_dir = Path(os.environ.get("WORK_DIR", ".")).resolve()

    reporter.emit(
        "log", level="info",
        message=f"dataset-generate: engine={params['engine']} "
                f"phrases={params['phrases']!r} postprocess={params['postprocess']}",
    )
    if not params.get("phrases"):
        reporter.emit("error", message="dataset-generate requires at least one phrase")
        return 1
    if params.get("engine") in ("mimo-tts", "qwen-llm-tts") and not params.get("apiKey"):
        reporter.emit(
            "error",
            message=f"engine '{params['engine']}' needs an API key "
                    "(set it in the Datasets generation wizard / Settings)",
        )
        return 1

    try:
        zip_path = generate_dataset(params, work_dir, reporter)
    except Exception as exc:  # noqa: BLE001
        reporter.emit("error", message=f"dataset-generate failed: {exc}")
        return 1

    reporter.emit("artifact", path=str(zip_path))
    reporter.emit("done", exitCode=0)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
