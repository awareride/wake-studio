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
UPSTREAM_DIR=/path/to/google-research \
UPSTREAM_PYTHON=/path/to/python-with-tensorflow \
STREAM_DATA_SOURCE=speech-commands-v2 \
STREAM_WANTED_WORDS=yes \
python train_adapter.py
```

Data sources: `speech-commands-v2` (CC BY 4.0), `user-url` (a dataset archive
URL), `edge-tts` (multi-language TTS synthesis), or `local-dir`.

## Tests

```bash
python -m pytest
```

Deterministic — a fake upstream `model_train_eval.py` under
`tests/fake_upstream/` produces the run-dir outputs without GPU or network.
