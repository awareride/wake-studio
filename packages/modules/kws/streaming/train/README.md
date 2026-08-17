# kws-streaming train adapter

Module-owned training wrapper for the `kws-streaming` driver
(Google Research `kws_streaming`, Apache-2.0). It runs the **upstream**
`kws_streaming/train/model_train_eval.py` UNCHANGED (ADR-031 — we adapt to the
script, never rewrite it) and normalizes the run directory into the standard
WakeStudio artifact bundle (`docs/modules/training.md` §4/§6).

## Run

Under the studio-backend (the service spawns this script as a child process
with job params mapped to `STREAM_*` env vars):

```bash
cd packages/modules/kws/streaming/train
UPSTREAM_PYTHON=/path/to/python-with-tensorflow \
STREAM_DATA_SOURCE=speech-commands-v2 \
STREAM_WANTED_WORDS=yes \
python train_adapter.py
```

The upstream `kws_streaming` package is **vendored** at the repo root
(`third_party/kws_streaming`, ADR-037 Tier 3) and auto-detected by the
adapter - no clone step. Set `UPSTREAM_DIR` only to override (e.g. point at
a custom `google-research` clone).

Data sources: `speech-commands-v2` (CC BY 4.0), `user-url` (a dataset archive
URL), `edge-tts` (multi-language TTS synthesis), or `local-dir`.

## Tests

```bash
python -m pytest
```

Deterministic — a fake upstream `model_train_eval.py` under
`tests/fake_upstream/` produces the run-dir outputs without GPU or network.
