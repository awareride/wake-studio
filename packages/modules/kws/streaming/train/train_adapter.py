#!/usr/bin/env python3
"""kws-streaming train adapter (google-research/kws_streaming, ADR-031, #152).

Module-owned wrapper that runs the **upstream** ``kws_streaming`` trainer
UNCHANGED (``python -m kws_streaming.train.model_train_eval``) and normalizes
its run directory into the standard WakeStudio artifact bundle
(docs/modules/training.md §6) — the same contract the openwakeword adapter
implements for its upstream (#127).

Params arrive as env vars (the notebook convention — the studio-backend
registry maps job params to ``STREAM_*``):

    STREAM_MODEL, STREAM_WANTED_WORDS, STREAM_WAKE_PHRASES,
    STREAM_TTS_LANGUAGES, STREAM_TTS_SAMPLES, STREAM_DATA_SOURCE,
    STREAM_POSITIVE_SOURCE, STREAM_NEGATIVE_SOURCE,
    STREAM_DATA_URL, STREAM_DATA_DIR, STREAM_FEATURE_TYPE, STREAM_PREPROCESS,
    STREAM_HOW_MANY_TRAINING_STEPS, STREAM_LEARNING_RATE, STREAM_SPLIT_DATA,
    STREAM_BACKGROUND_VOLUME, STREAM_BACKGROUND_FREQUENCY,
    STREAM_SILENCE_PERCENTAGE, STREAM_UNKNOWN_PERCENTAGE, STREAM_JOB_ID,
    STREAM_BACKEND

Paths (env, with defaults):

    UPSTREAM_DIR    default <repo>/third_party         (vendored upstream, ADR-037;
                                                      auto-detected; override only
                                                      for a custom clone)
    UPSTREAM_PYTHON default sys.executable             (the env with tensorflow)
    WORK_DIR        default cwd
    OUT_DIR         default <WORK_DIR>/wake-studio-results

Data sources (``STREAM_DATA_SOURCE``):

    speech-commands-v2  download + extract Speech Commands V2 (CC BY 4.0)
    user-url            download + extract a user-provided dataset archive
    edge-tts            synthesize a multi-language label tree via edge-tts
    local-dir           use STREAM_DATA_DIR as-is (tests / pre-prepared data)
    mixed               merge two sources: positiveSource (positives =
                        wanted words) + negativeSource (real speech /
                        noise; folds into _unknown_)

Emits the NDJSON reporting protocol (docs/modules/training.md §4.4) on stdout:
``log`` (streamed upstream output), ``progress`` (per stage), ``heartbeat``,
``metrics`` (parsed from the accuracy files), ``artifact`` (the bundle zip),
``error``/``done``.
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


DEFAULTS: dict[str, Any] = {
    "model": "ds_tc_resnet",
    "wantedWords": "yes",
    "wakePhrases": "hey studio",
    "ttsLanguages": "en-US",
    "ttsSamples": 3,
    "dataSource": "speech-commands-v2",
    "positiveSource": "edge-tts",
    "negativeSource": "speech-commands-v2",
    "dataUrl": "",
    "dataDir": "./data2",
    "featureType": "mfcc_op",
    "preprocess": "raw",
    "howManyTrainingSteps": "10000,10000,10000",
    "learningRate": "0.0005,0.0001,0.00002",
    "splitData": 1,
    "backgroundVolume": 0.1,
    "backgroundFrequency": 0.8,
    "silencePercentage": 10.0,
    "unknownPercentage": 10.0,
    "jobId": None,
    "backend": "colab",
}

ENV_MAP: dict[str, str] = {
    "STREAM_MODEL": "model",
    "STREAM_WANTED_WORDS": "wantedWords",
    "STREAM_WAKE_PHRASES": "wakePhrases",
    "STREAM_TTS_LANGUAGES": "ttsLanguages",
    "STREAM_TTS_SAMPLES": "ttsSamples",
    "STREAM_DATA_SOURCE": "dataSource",
    "STREAM_POSITIVE_SOURCE": "positiveSource",
    "STREAM_NEGATIVE_SOURCE": "negativeSource",
    "STREAM_DATA_URL": "dataUrl",
    "STREAM_DATA_DIR": "dataDir",
    "STREAM_FEATURE_TYPE": "featureType",
    "STREAM_PREPROCESS": "preprocess",
    "STREAM_HOW_MANY_TRAINING_STEPS": "howManyTrainingSteps",
    "STREAM_LEARNING_RATE": "learningRate",
    "STREAM_SPLIT_DATA": "splitData",
    "STREAM_BACKGROUND_VOLUME": "backgroundVolume",
    "STREAM_BACKGROUND_FREQUENCY": "backgroundFrequency",
    "STREAM_SILENCE_PERCENTAGE": "silencePercentage",
    "STREAM_UNKNOWN_PERCENTAGE": "unknownPercentage",
    "STREAM_JOB_ID": "jobId",
    "STREAM_BACKEND": "backend",
}

STAGES = ["prepare_data", "train", "bundle"]

# Declared TensorFlow line the patched upstream runs on (ADR-038). This is the
# only place the adapter knows the pin: keep it in sync with the module `tf`
# extra (pyproject.toml) and re-lock uv.lock in the same commit as any change.
REQUIRED_TF_LINE = "2.15"


def _coerce(value: Any, default: Any) -> Any:
    """Coerce an env string to the type of its default."""
    if isinstance(default, bool):
        return str(value).lower() in ("1", "true", "yes")
    if isinstance(default, int):
        return int(value)
    if isinstance(default, float):
        return float(value)
    return str(value)


def read_params(env: dict[str, str] | None = None) -> dict[str, Any]:
    """Job params from STREAM_* env vars + WAKE_PARAMS JSON (both conventions).

    The studio-backend registry always sets WAKE_PARAMS (JSON) plus one
    WAKE_<KEY> per param; the STREAM_* names are the explicit registry mapping.
    An empty value is treated as "unset" (fall back to the default).
    """
    env = env if env is not None else os.environ
    params: dict[str, Any] = dict(DEFAULTS)

    raw_json = env.get("WAKE_PARAMS", "")
    if raw_json:
        try:
            for key, value in json.loads(raw_json).items():
                if key in DEFAULTS:
                    params[key] = _coerce(value, DEFAULTS[key])
        except (ValueError, TypeError):
            pass

    for var, key in ENV_MAP.items():
        raw = env.get(var, "")
        if raw != "":
            params[key] = _coerce(raw, DEFAULTS[key])

    if not params["jobId"]:
        params["jobId"] = f"kws-streaming-{int(time.time() * 1000)}"
    return params


def _sanitize_label(text: str) -> str:
    return "_".join(text.strip().lower().split()) or "word"


def _import_data_sources() -> Any:
    try:
        from wake_train_kit import data_sources
    except ImportError as exc:  # pragma: no cover - service installs wake_train_kit
        raise RuntimeError(
            "wake_train_kit.data_sources is not importable; run the adapter "
            "under the studio-backend (uv run wake-service) or install it"
        ) from exc
    return data_sources


def prepare_data(
    params: dict[str, Any], work_dir: Path, reporter: Reporter
) -> tuple[str, list[dict[str, Any]], str]:
    """Prepare the `label/*.wav` tree. -> (data_dir, provenance, wanted_words)."""
    source = params["dataSource"]
    wanted = params["wantedWords"]
    sources: list[dict[str, Any]] = []

    if source == "local-dir":
        data_dir = Path(params["dataDir"])
        if not data_dir.is_absolute():
            data_dir = work_dir / data_dir
        data_dir = data_dir.resolve()
        if not data_dir.is_dir():
            raise FileNotFoundError(f"local data dir not found: {data_dir}")
        return str(data_dir), sources, wanted

    ds = _import_data_sources()

    if source == "speech-commands-v2":
        root, prov = ds.prepare_speech_commands_v2(work_dir / "data2", reporter)
        sources.append(prov)
        return str(root), sources, wanted

    if source == "user-url":
        root, prov = ds.prepare_user_archive(params["dataUrl"], work_dir / "data", reporter)
        sources.append(prov)
        return str(root), sources, wanted

    if source == "edge-tts":
        phrases = [p.strip() for p in params["wakePhrases"].split(",") if p.strip()]
        languages = [l.strip() for l in params["ttsLanguages"].split(",") if l.strip()]
        out = work_dir / "data_tts"
        prov = ds.build_edge_tts_kws_dataset(
            phrases,
            languages,
            out,
            samples_per_phrase=params["ttsSamples"],
            reporter=reporter,
        )
        sources.append(prov)
        wanted = ",".join(_sanitize_label(p) for p in phrases)
        return str(out), sources, wanted

    if source == "mixed":
        # positives come from the positive source (edge-tts today; user-url /
        # local-dir later); negatives from the negative source (real speech /
        # noise). Both trees are merged into one data root; positive labels
        # are the wanted words, everything else folds into _unknown_ upstream.
        positive_source = params["positiveSource"]
        negative_source = params["negativeSource"]
        pos_root: Path
        pos_prov: dict[str, Any]

        if positive_source == "edge-tts":
            phrases = [
                p.strip() for p in params["wakePhrases"].split(",") if p.strip()
            ]
            languages = [
                l.strip() for l in params["ttsLanguages"].split(",") if l.strip()
            ]
            pos_root = work_dir / "data_tts_pos"
            pos_prov = ds.build_edge_tts_kws_dataset(
                phrases,
                languages,
                pos_root,
                samples_per_phrase=params["ttsSamples"],
                reporter=reporter,
            )
            wanted = ",".join(_sanitize_label(p) for p in phrases)
        elif positive_source == "user-url":
            pos_root, pos_prov = ds.prepare_user_archive(
                params["dataUrl"], work_dir / "data_pos", reporter
            )
            wanted = params["wantedWords"]
        else:
            raise ValueError(f"mixed: unsupported positiveSource '{positive_source}'")
        sources.append(pos_prov)

        neg_root: Path | None = None
        if negative_source == "speech-commands-v2":
            neg_root, neg_prov = ds.prepare_speech_commands_v2(
                work_dir / "data_neg", reporter
            )
            sources.append(neg_prov)
        elif negative_source == "user-url":
            neg_root, neg_prov = ds.prepare_user_archive(
                params["dataUrl"], work_dir / "data_neg", reporter
            )
            sources.append(neg_prov)
        elif negative_source != "none":
            raise ValueError(f"mixed: unsupported negativeSource '{negative_source}'")

        merged = ds.merge_label_trees(pos_root, neg_root, work_dir / "data_mixed")
        return str(merged), sources, wanted

    raise ValueError(f"unknown dataSource '{source}'")


def build_command(
    params: dict[str, Any],
    python: str,
    data_dir: str,
    train_dir: str,
    wanted_words: str,
) -> list[str]:
    """The unmodified upstream invocation (base flags only; model defaults)."""
    return [
        python, "-m", "kws_streaming.train.model_train_eval",
        "--data_url", "",
        "--data_dir", data_dir,
        "--train_dir", train_dir,
        "--wanted_words", wanted_words,
        "--split_data", str(params["splitData"]),
        "--preprocess", params["preprocess"],
        "--feature_type", params["featureType"],
        "--how_many_training_steps", params["howManyTrainingSteps"],
        "--learning_rate", params["learningRate"],
        "--background_volume", str(params["backgroundVolume"]),
        "--background_frequency", str(params["backgroundFrequency"]),
        "--silence_percentage", str(params["silencePercentage"]),
        "--unknown_percentage", str(params["unknownPercentage"]),
        "--train", "1",
        "--alsologtostderr",
        params["model"],
    ]


_FLOAT_RE = re.compile(r"([0-9]+\.[0-9]+)")


def parse_metrics(train_dir: Path, log_text: str) -> dict[str, Any]:
    """Best-effort accuracy extraction from the upstream run directory."""
    metrics: dict[str, Any] = {
        "status": "ok",
        "note": "parsed best-effort from the upstream accuracy files",
    }
    candidates = [
        ("streaming_accuracy_reset0", train_dir / "tflite_stream_state_external"
         / "tflite_stream_state_external_model_accuracy_reset0.txt"),
        ("streaming_accuracy_reset1", train_dir / "tflite_stream_state_external"
         / "tflite_stream_state_external_model_accuracy_reset1.txt"),
        ("last_training_accuracy", train_dir / "accuracy_last.txt"),
    ]
    for key, path in candidates:
        if path.is_file():
            text = path.read_text(encoding="utf-8", errors="replace")
            m = _FLOAT_RE.search(text)
            if m:
                metrics[key] = float(m.group(1))
    if log_text:
        metrics["log_tail"] = log_text.strip().splitlines()[-20:]
    return metrics


def run_upstream(
    cmd: list[str],
    cwd: str,
    env: dict[str, str],
    reporter: Reporter,
    log_lines: list[str],
) -> int:
    """Run the upstream trainer, streaming its output as NDJSON log lines."""
    reporter.emit("log", level="info", message=f"upstream: {' '.join(cmd)}")
    proc = subprocess.Popen(
        cmd,
        cwd=cwd,
        env=env,
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
    wanted_words: str,
    train_dir: Path,
    out_root: Path,
    sources: list[dict[str, Any]],
    log_text: str,
    reporter: Reporter,
) -> Path:
    """Normalize the upstream run dir into the standard bundle (§6) and zip it."""
    model_src = train_dir / "tflite_stream_state_external" / "stream_state_external.tflite"
    if not model_src.is_file():
        raise FileNotFoundError(
            f"streaming tflite not found: {model_src} — the model is non-streamable "
            f"or the upstream train step did not produce it"
        )

    bundle_dir = Path(out_root) / params["jobId"]
    bundle_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy(model_src, bundle_dir / "model.tflite")
    for name in ("labels.txt", "flags.json"):
        p = train_dir / name
        if p.is_file():
            shutil.copy(p, bundle_dir / name)

    # Standard ordered label list (ADR-039 §4.5): upstream labels.txt (one
    # label per line, class-index order) becomes the standard labels.json.
    labels: list[str] = []
    labels_txt = train_dir / "labels.txt"
    if labels_txt.is_file():
        labels = [
            ln.strip() for ln in labels_txt.read_text(encoding="utf-8").splitlines()
            if ln.strip()
        ]
    if labels:
        (bundle_dir / "labels.json").write_text(json.dumps(labels), encoding="utf-8")

    metrics = parse_metrics(train_dir, log_text)
    metrics["training_steps"] = params["howManyTrainingSteps"]
    (bundle_dir / "metrics.json").write_text(json.dumps(metrics, indent=2), encoding="utf-8")

    metadata = {
        "jobId": params["jobId"],
        "moduleId": "kws-streaming",
        "backend": params["backend"],
        "provider": params["backend"],
        "params": {
            "model": params["model"],
            "wantedWords": wanted_words,
            "featureType": params["featureType"],
            "preprocess": params["preprocess"],
            "dataSource": params["dataSource"],
            "trainingSteps": params["howManyTrainingSteps"],
            "learningRate": params["learningRate"],
        },
        "labels": labels or None,
        "trainedAtMs": int(time.time() * 1000),
    }
    (bundle_dir / "metadata.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")

    provenance = {
        "license": "user-owned",
        "sourceData": sources or [
            {"name": "Google Speech Commands V2", "license": "CC BY 4.0",
             "source": "https://storage.googleapis.com/download.tensorflow.org/data/speech_commands_v0.02.tar.gz"}
        ],
        "notes": (
            "Classifier trained from the Apache-2.0 google-research/kws_streaming "
            "code (no restricted pre-trained weights). The model is commercially "
            "ownable; verify any user-provided dataset license before commercial use."
        ),
    }
    (bundle_dir / "provenance.json").write_text(json.dumps(provenance, indent=2), encoding="utf-8")

    config_snapshot = {
        "model": params["model"],
        "wantedWords": wanted_words,
        "featureType": params["featureType"],
        "preprocess": params["preprocess"],
        "dataSource": params["dataSource"],
        "sampleRate": 16000,
        "clipDurationMs": 1000,
        "backend": params["backend"],
    }
    (bundle_dir / "config.json").write_text(json.dumps(config_snapshot, indent=2), encoding="utf-8")

    zip_path = bundle_dir / "wake-studio-results.zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for name in ("model.tflite", "labels.txt", "labels.json", "flags.json",
                     "metrics.json", "metadata.json", "provenance.json",
                     "config.json"):
            p = bundle_dir / name
            if p.is_file():
                zf.write(p, arcname=f"{params['jobId']}/{name}")
    reporter.emit("log", level="info", message=f"bundle ready: {zip_path}")
    return zip_path


def default_upstream_dir() -> Path:
    """Locate the vendored upstream (ADR-037 Tier 3, #156).

    Copies of this adapter live at different depths (module train dir, PWA
    ``public/train`` copy), so probe ancestors for a ``third_party`` dir that
    contains the vendored ``kws_streaming`` package. Falls back to the
    historical ``./google-research`` clone layout so existing setups keep
    working.
    """
    here = Path(__file__).resolve()
    for parent in here.parents:
        candidate = parent / "third_party"
        if (candidate / "kws_streaming" / "train" / "model_train_eval.py").is_file():
            return candidate
    return Path("./google-research")


def upstream_tf_version(
    python: str, cwd: str | None = None, env: dict[str, str] | None = None
) -> str | None:
    """Report the TensorFlow version the given python actually provides, or
    None if TensorFlow is not importable there (or the probe fails).

    Runs with the same cwd/env the training subprocess will use, so the probe
    reflects exactly what upstream training will import."""
    try:
        probe = subprocess.run(
            [python, "-c", "import tensorflow as tf; print(tf.__version__)"],
            cwd=cwd, env=env, capture_output=True, text=True, timeout=120,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if probe.returncode != 0:
        return None
    return probe.stdout.strip().splitlines()[-1].strip() or None


def check_upstream_tf(
    python: str,
    reporter: Reporter,
    cwd: str | None = None,
    env: dict[str, str] | None = None,
) -> bool:
    """Fail loudly if the upstream python's TF drifts from the declared pin
    (ADR-038: no silent divergence between declared and trained-on TF)."""
    version = upstream_tf_version(python, cwd=cwd, env=env)
    # Plain-text line (non-NDJSON) so the probed TF is visible in the raw job
    # log even if NDJSON events are filtered - cannot be missed.
    print(
        f"[tf-guard] probe: python={python} -> "
        f"tensorflow {version or 'MISSING'} (required {REQUIRED_TF_LINE}.x)",
        flush=True,
    )
    if version is None:
        reporter.emit("error", message=(
            f"TensorFlow not found in the upstream python ({python}); "
            f"kws-streaming requires the declared TF {REQUIRED_TF_LINE}.x env "
            f"(module tf extra, ADR-038)."
        ))
        return False
    if not version.startswith(REQUIRED_TF_LINE + "."):
        reporter.emit("error", message=(
            f"TensorFlow drift: upstream python ({python}) has TF {version}, "
            f"declared pin is TF {REQUIRED_TF_LINE}.x (module tf extra, "
            f"ADR-038). Re-lock uv.lock and update REQUIRED_TF_LINE together."
        ))
        return False
    reporter.emit("log", level="info", message=(
        f"TF check ok: TensorFlow {version} matches the declared "
        f"{REQUIRED_TF_LINE}.x line"
    ))
    return True


def main(argv: list[str] | None = None) -> int:
    reporter = Reporter()
    params = read_params()

    upstream_dir = Path(os.environ.get("UPSTREAM_DIR") or default_upstream_dir())
    python = os.environ.get("UPSTREAM_PYTHON") or sys.executable
    work_dir = Path(os.environ.get("WORK_DIR", ".")).resolve()
    out_root = Path(os.environ.get("OUT_DIR", work_dir / "wake-studio-results"))
    train_dir = work_dir / "train" / params["model"]

    reporter.emit("log", level="info", message=(
        f"kws-streaming adapter: model={params['model']} "
        f"source={params['dataSource']} steps={params['howManyTrainingSteps']} "
        f"upstream={upstream_dir} python={python}"
    ))
    # Plain-text banner (non-NDJSON) emitted before anything else: names the
    # interpreter the adapter runs under and the one that will train, so the
    # raw job log's first lines identify the environment unambiguously.
    print(
        f"[tf-guard] adapter python: {sys.executable} | "
        f"training python: {python} | skip={bool(os.environ.get('STREAM_SKIP_TF_GUARD'))}",
        flush=True,
    )

    if not (upstream_dir / "kws_streaming").is_dir():
        reporter.emit("error", message=(
            f"upstream kws_streaming not found under {upstream_dir} "
            f"(expected the vendored third_party/kws_streaming; or set "
            f"UPSTREAM_DIR to a google-research clone)"
        ))
        return 1

    # The upstream subprocess env (PYTHONPATH to the vendored upstream). Built
    # once and shared by the drift-guard probe AND the training run, so the
    # probe can never observe a different TensorFlow than training imports.
    upstream_env = dict(os.environ)
    upstream_env["PYTHONPATH"] = (
        str(upstream_dir) + os.pathsep + upstream_env.get("PYTHONPATH", "")
    )

    # stage 0: TF drift guard (ADR-038) - fail loudly before any download/train
    # if the runtime TF drifts from the declared pin, instead of training on a
    # silently different TensorFlow. The fake-upstream tests opt out via
    # STREAM_SKIP_TF_GUARD (they run without TensorFlow).
    if not os.environ.get("STREAM_SKIP_TF_GUARD"):
        if not check_upstream_tf(
            python, reporter, cwd=str(upstream_dir), env=upstream_env
        ):
            return 1

    # stage 1: data
    reporter.emit("progress", step=1, total=len(STAGES), progress=1 / len(STAGES),
                  message="prepare_data")
    try:
        data_dir, sources, wanted = prepare_data(params, work_dir, reporter)
    except Exception as exc:  # noqa: BLE001
        reporter.emit("error", message=f"data error: {exc}")
        return 1

    # stage 2: upstream train (unmodified)
    reporter.emit("progress", step=2, total=len(STAGES), progress=2 / len(STAGES),
                  message="train")
    # The upstream trainer (model_train_eval.py) creates ``train_dir`` itself and
    # aborts with "model already exists" if the directory is already present, so
    # we must not pre-create it here. Remove any output left by a previous run
    # so each training pass starts from a clean directory.
    if train_dir.exists():
        shutil.rmtree(train_dir)
    cmd = build_command(params, python, data_dir, str(train_dir), wanted)
    log_lines: list[str] = []
    code = run_upstream(cmd, str(upstream_dir), upstream_env, reporter, log_lines)
    if code != 0:
        reporter.emit("error", message=f"upstream train exited with code {code}")
        return code

    # stage 3: bundle
    reporter.emit("progress", step=3, total=len(STAGES), progress=1.0,
                  message="bundle")
    try:
        bundle_zip = build_bundle(
            params, wanted, train_dir, out_root, sources,
            "\n".join(log_lines), reporter,
        )
    except Exception as exc:  # noqa: BLE001
        reporter.emit("error", message=f"bundle error: {exc}")
        return 1

    reporter.emit("artifact", path=str(bundle_zip))
    reporter.emit("done", exitCode=0)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
