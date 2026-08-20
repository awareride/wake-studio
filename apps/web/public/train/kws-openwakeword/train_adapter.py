#!/usr/bin/env python3
"""OpenWakeWord train adapter (docs/modules/training.md §4, ADR-031, #127).

Module-owned wrapper that runs the **upstream openWakeWord `train.py`
UNCHANGED** (we adapt to the script, never rewrite it) and normalizes the run
into the standard WakeStudio artifact bundle (§6) — the same logic the
module-owned Colab notebook's Steps 4–5 implement, but as a service-invocable
script (the studio-backend registry `entry`, ADR-036).

Params arrive as env vars (the notebook convention — the registry maps job
params to `WAKE_*`):

    WAKE_PHRASE, WAKE_N_SAMPLES, WAKE_N_SAMPLES_VAL, WAKE_STEPS,
    WAKE_FALSE_ACTIVATION, WAKE_AUGMENT, WAKE_QUANTIZE, WAKE_JOB_ID,
    WAKE_TARGET, WAKE_BACKEND

Paths (env, with defaults):

    UPSTREAM_DIR    default ./openwakeword          (upstream clone)
    UPSTREAM_TRAIN  default <UPSTREAM_DIR>/openwakeword/train.py
    UPSTREAM_PYTHON default sys.executable          (the env with torch)
    WORK_DIR        default cwd                     (data + config + model dir)
    OUT_DIR         default <WORK_DIR>/wake-studio-results

Emits the NDJSON reporting protocol (§4.4) on stdout: `log` (streamed
upstream output), `progress` (per stage), `heartbeat`, `metrics` (parsed from
the train log), `artifact` (the bundle zip), `error`/`done`.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import time
import zipfile
from pathlib import Path
from typing import Any

try:  # the service's reporter (installed with wake-service / the launcher)
    from wake_train_kit.report import Reporter
except ImportError:  # standalone fallback: plain NDJSON prints
    class Reporter:  # type: ignore[no-redef]
        def emit(self, event: str, **fields: Any) -> None:
            print(json.dumps({"event": event, **fields}), flush=True)

DEFAULTS = {
    "wakePhrase": "hey studio",
    "target": "app-class",
    "nSamples": 1000,
    "nSamplesVal": 1000,
    "steps": 10000,
    "falseActivationPenalty": 1500,
    "augment": True,
    "quantize": True,
    "formats": "onnx",
    "quantization": "int8-static",
    "datasets": "",
}

STAGES: list[tuple[str, str]] = [
    ("generate_clips", "--generate_clips"),
    ("augment_clips", "--augment_clips"),
    ("train_model", "--train_model"),
]

METRIC_PATTERNS: dict[str, str] = {
    "recall": r"recall[^0-9]*([0-9.]+)",
    "accuracy": r"accuracy[^0-9]*([0-9.]+)",
    "false_positives_per_hour": r"false[- ]?positives?[^0-9]*([0-9.]+)",
}


def read_params(env: dict[str, str] | None = None) -> dict[str, Any]:
    """Job params from WAKE_* env vars (same names as the notebook, #127).

    Registry env templates render missing params as empty strings, so an
    empty value is treated as "unset" (fall back to the default).
    """
    env = env or os.environ

    def _s(name: str, default: Any) -> Any:
        raw = env.get(name, "")
        return default if raw == "" else raw

    def _int(name: str, default: int) -> int:
        raw = env.get(name, "").strip()
        return int(raw) if raw else default

    def flag(name: str, default: bool) -> bool:
        raw = env.get(name, "").lower()
        return default if raw == "" else raw in ("1", "true", "yes")

    quantize = flag("WAKE_QUANTIZE", DEFAULTS["quantize"])
    return {
        "wakePhrase": _s("WAKE_PHRASE", DEFAULTS["wakePhrase"]),
        "target": _s("WAKE_TARGET", DEFAULTS["target"]),
        "nSamples": _int("WAKE_N_SAMPLES", DEFAULTS["nSamples"]),
        "nSamplesVal": _int("WAKE_N_SAMPLES_VAL", DEFAULTS["nSamplesVal"]),
        "steps": _int("WAKE_STEPS", DEFAULTS["steps"]),
        "falseActivationPenalty": _int(
            "WAKE_FALSE_ACTIVATION", DEFAULTS["falseActivationPenalty"]
        ),
        "augment": flag("WAKE_AUGMENT", DEFAULTS["augment"]),
        "quantize": quantize,
        # ADR-039 §4.6: formats/quantization selectors. Defaults preserve the
        # legacy quantize flag behaviour (a quantized tflite is produced).
        "formats": _s("WAKE_FORMATS", DEFAULTS["formats"]),
        "quantization": _s(
            "WAKE_QUANTIZATION", "int8-static" if quantize else "none"
        ),
        "datasets": _s("WAKE_DATASETS", DEFAULTS["datasets"]),
        "jobId": _s("WAKE_JOB_ID", f"kws-openwakeword-{int(time.time() * 1000)}"),
        "backend": _s("WAKE_BACKEND", "colab"),
    }


def _import_materialize() -> Any:
    try:
        from wake_train_kit import materialize
    except ImportError as exc:  # pragma: no cover - service installs wake_train_kit
        raise RuntimeError(
            "wake_train_kit.materialize is not importable; run the adapter "
            "under the studio-backend (uv run wake-service) or install it"
        ) from exc
    return materialize


def _module_train_dataset_spec() -> dict[str, Any]:
    """The module's `spec.train.dataset` requirements (single source of truth)."""
    spec_path = Path(__file__).resolve().parent.parent / "spec" / "module.spec.json"
    try:
        spec = json.loads(spec_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return (spec.get("train") or {}).get("dataset") or {}


def build_config(
    params: dict[str, Any],
    base_config_path: str | Path,
    output_path: str | Path,
    materialized: Any = None,
) -> dict[str, Any]:
    """Load the upstream custom_model.yml and override with job params.

    Mirrors the notebook's Step 4 config writing exactly (ADR-031: the
    upstream script stays byte-identical; we only feed it a config). When a
    `materialized` openwakeword shape is given (#206, from the wizard's
    `datasets[]` refs), the target phrase, background paths and precomputed
    negative features come from the materializer instead of the legacy
    defaults.
    """
    import yaml

    raw = Path(base_config_path).read_text(encoding="utf-8")
    config = yaml.load(raw, Loader=yaml.Loader)  # mirror the upstream notebook

    if materialized is not None:
        # target phrase = the dataset's positive label(s)
        config["target_phrase"] = list(materialized.target_phrase)
        config["background_paths"] = list(materialized.background_paths) or [
            "./audioset_16k", "./fma"
        ]
        config["feature_data_files"] = dict(materialized.feature_data_files) or {
            "ACAV100M_sample": "openwakeword_features_ACAV100M_2000_hrs_16bit.npy"
        }
        # WakeStudio extension: the materialized positives wav dir (upstream
        # --generate_clips integration can consume it directly).
        config["positives_dir"] = str(materialized.positives_dir)
        config["materialized_dir"] = str(materialized.materialized_dir)
    else:
        config["target_phrase"] = [params["wakePhrase"]]
        config["background_paths"] = ["./audioset_16k", "./fma"]
        config["feature_data_files"] = {
            "ACAV100M_sample": "openwakeword_features_ACAV100M_2000_hrs_16bit.npy"
        }

    config["model_name"] = config["target_phrase"][0].replace(" ", "_")
    config["n_samples"] = params["nSamples"]
    config["n_samples_val"] = params["nSamplesVal"]
    config["steps"] = params["steps"]
    config["target_accuracy"] = 0.5
    config["target_recall"] = 0.25
    config["output_dir"] = "./my_custom_model"
    config["max_negative_weight"] = params["falseActivationPenalty"]
    config["false_positive_validation_data_path"] = "validation_set_features.npy"
    Path(output_path).write_text(yaml.dump(config), encoding="utf-8")
    return config


def parse_metrics(log_text: str) -> dict[str, Any]:
    """Best-effort FAR/FRR/loss extraction from the upstream train log."""
    metrics: dict[str, Any] = {
        "status": "ok",
        "note": "parsed best-effort from the upstream train log",
    }
    if log_text:
        metrics["log_tail"] = log_text.strip().splitlines()[-20:]
        for key, pattern in METRIC_PATTERNS.items():
            m = re.search(pattern, log_text, re.IGNORECASE)
            if m:
                try:
                    metrics[key] = float(m.group(1))
                except ValueError:
                    pass
    return metrics


def run_stage(
    python: str,
    train_script: str,
    config_path: str,
    flag: str,
    cwd: str,
    reporter: Reporter,
    log_lines: list[str],
) -> int:
    """Run one upstream train.py stage, streaming output as NDJSON log lines."""
    reporter.emit("log", level="info", message=f"stage {flag} starting")
    proc = subprocess.Popen(
        [python, train_script, "--training_config", config_path, flag],
        cwd=cwd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    assert proc.stdout is not None
    last = time.monotonic()
    for line in proc.stdout:
        line = line.rstrip("\n")
        log_lines.append(line)
        reporter.emit("log", level="debug", message=line)
        if time.monotonic() - last > 30:
            reporter.emit("heartbeat")
            last = time.monotonic()
    return proc.wait()


def build_bundle(
    params: dict[str, Any],
    config: dict[str, Any],
    work_dir: str | Path,
    out_root: str | Path,
    log_text: str,
    reporter: Reporter,
) -> Path:
    """Normalize the run into the standard bundle (§6) and zip it."""
    work_dir = Path(work_dir)
    model_name = config["model_name"]
    model_dir = work_dir / config.get("output_dir", "./my_custom_model")
    onnx_path = model_dir / f"{model_name}.onnx"
    tflite_path = model_dir / f"{model_name}.tflite"

    if not onnx_path.is_file():
        raise FileNotFoundError(
            f"model not found: {onnx_path} — the upstream train stage did not produce it"
        )

    bundle_dir = Path(out_root) / params["jobId"]
    bundle_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy(onnx_path, bundle_dir / "model.onnx")

    # ADR-039 §4.6: requested formats (comma-separated select) vs what shipped.
    requested = [f.strip() for f in params["formats"].split(",") if f.strip()] or ["onnx"]
    want_tflite = any(f in ("tflite", "tflite-int8") for f in requested)
    shipped = ["onnx"]
    if tflite_path.is_file() and (want_tflite or params["quantize"]):
        shutil.copy(tflite_path, bundle_dir / "model.tflite")
        shipped.append("tflite-int8" if "tflite-int8" in requested else "tflite")

    # Standard ordered label list (ADR-039 §4.5): single-phrase classifier.
    # With the datasets[] path the phrase comes from the materialized positives.
    labels = list(config.get("target_phrase") or [params["wakePhrase"]])
    (bundle_dir / "labels.json").write_text(json.dumps(labels), encoding="utf-8")

    metrics = parse_metrics(log_text)
    metrics["steps"] = params["steps"]
    metrics["epochs"] = params["steps"]  # upstream trains for `steps` optimizer steps
    (bundle_dir / "metrics.json").write_text(json.dumps(metrics, indent=2), encoding="utf-8")

    metadata = {
        "jobId": params["jobId"],
        "moduleId": "kws-openwakeword",
        "backend": params["backend"],
        "provider": params["backend"],
        "params": {
            "wakePhrase": params["wakePhrase"],
            "datasets": params.get("datasets") or None,
            "target": params["target"],
            "epochs": str(params["steps"]),
            "augment": str(params["augment"]).lower(),
            "quantize": str(params["quantize"]).lower(),
        },
        "formats": {"requested": requested, "shipped": shipped},
        "labels": labels,
        "trainedAtMs": int(time.time() * 1000),
    }
    (bundle_dir / "metadata.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")

    provenance = {
        "license": "user-owned",
        "sourceData": [
            {"name": "piper-sample-generator synthetic speech", "license": "MIT (code); Piper voice model license", "source": "https://github.com/rhasspy/piper-sample-generator"},
            {"name": "openWakeWord feature extractors (frozen)", "license": "Apache-2.0", "source": "https://github.com/dscripka/openWakeWord"},
            {"name": "background audio (AudioSet / FMA samples)", "license": "research-use; verify before commercial deployment", "source": "https://huggingface.co/datasets/agkphysics/AudioSet, https://huggingface.co/datasets/rudraml/fma"},
        ],
        "notes": "Trained from synthetic TTS audio + precomputed openWakeWord features. The classifier is user-owned; pre-trained openWakeWord models (CC BY-NC-SA) are NOT bundled.",
    }
    (bundle_dir / "provenance.json").write_text(json.dumps(provenance, indent=2), encoding="utf-8")

    config_snapshot = {
        "wakePhrase": params["wakePhrase"],
        "target": params["target"],
        "backend": params["backend"],
        "provider": params["backend"],
        "model_type": config.get("model_type", "dnn"),
        "layer_size": config.get("layer_size", 32),
        "steps": params["steps"],
        "n_samples": params["nSamples"],
        "n_samples_val": params["nSamplesVal"],
        "augment": params["augment"],
        "quantize": params["quantize"],
        "clip_size_seconds": 3,
    }
    (bundle_dir / "config.json").write_text(json.dumps(config_snapshot, indent=2), encoding="utf-8")

    zip_path = bundle_dir / "wake-studio-results.zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for name in ("model.onnx", "model.tflite", "labels.json", "metrics.json",
                     "metadata.json", "provenance.json", "config.json"):
            p = bundle_dir / name
            if p.is_file():
                zf.write(p, arcname=f"{params['jobId']}/{name}")
    reporter.emit("log", level="info", message=f"bundle ready: {zip_path}")
    return zip_path


def main(argv: list[str] | None = None) -> int:
    reporter = Reporter()
    params = read_params()

    upstream_dir = Path(os.environ.get("UPSTREAM_DIR", "./openwakeword"))
    upstream_train = os.environ.get(
        "UPSTREAM_TRAIN", str(upstream_dir / "openwakeword" / "train.py")
    )
    python = os.environ.get("UPSTREAM_PYTHON") or sys.executable
    work_dir = Path(os.environ.get("WORK_DIR", ".")).resolve()
    out_root = Path(os.environ.get("OUT_DIR", work_dir / "wake-studio-results"))
    config_path = work_dir / "my_model.yaml"

    reporter.emit("log", level="info", message=(
        f"openwakeword adapter: phrase={params['wakePhrase']!r} "
        f"samples={params['nSamples']} steps={params['steps']} "
        f"upstream={upstream_train} python={python}"
    ))

    if not Path(upstream_train).is_file():
        reporter.emit("error", message=(
            f"upstream train.py not found: {upstream_train} "
            f"(set UPSTREAM_TRAIN / UPSTREAM_DIR)"
        ))
        return 1

    base_config = upstream_dir / "examples" / "custom_model.yml"
    if not base_config.is_file():
        reporter.emit("error", message=f"upstream config not found: {base_config}")
        return 1

    try:
        materialized = None
        if params.get("datasets"):
            mat = _import_materialize()
            store = mat.open_dataset_store(os.environ.get("DATASETS_DIR"))
            dataset_ids = [
                i.strip() for i in params["datasets"].split(",") if i.strip()
            ]
            if not dataset_ids:
                raise ValueError("datasets param is empty — pick at least one dataset")
            materialized = mat.materialize_openwakeword(
                store,
                dataset_ids,
                work_dir / "data_datasets",
                reporter=reporter,
                requirements=_module_train_dataset_spec(),
            )
            for warning in materialized.warnings:
                reporter.emit("log", level="warn", message=f"dataset: {warning}")
        config = build_config(params, base_config, config_path, materialized)
    except Exception as exc:  # noqa: BLE001
        reporter.emit("error", message=f"config error: {exc}")
        return 1

    log_lines: list[str] = []
    for i, (_name, flag) in enumerate(STAGES, start=1):
        reporter.emit("progress", step=i, total=len(STAGES),
                      progress=i / len(STAGES), message=f"stage {flag}")
        code = run_stage(python, upstream_train, str(config_path), flag,
                         str(work_dir), reporter, log_lines)
        if code != 0:
            reporter.emit("error", message=f"stage {flag} exited with code {code}")
            return code

    try:
        bundle_zip = build_bundle(params, config, work_dir, out_root,
                                  "\n".join(log_lines), reporter)
    except Exception as exc:  # noqa: BLE001
        reporter.emit("error", message=f"bundle error: {exc}")
        return 1

    reporter.emit("artifact", path=str(bundle_zip))
    reporter.emit("done", exitCode=0)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
