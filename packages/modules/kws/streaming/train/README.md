# kws-streaming train adapter

Module-owned training wrapper for the `kws-streaming` driver
(Google Research `kws_streaming`, Apache-2.0). It runs the **upstream**
`kws_streaming/train/model_train_eval.py` UNCHANGED (ADR-031 — we adapt to the
script, never rewrite it) and normalizes the run directory into the standard
WakeStudio artifact bundle (`docs/modules/training.md` §4/§6).

The vendored upstream is an **explicit maintained fork** (ADR-038, #170):
pristine import + the two TF >= 2.16 compat patches, run on the pinned
Keras-2 line — `tensorflow[and-cuda]==2.15.1`, `numpy==1.26.4`,
`protobuf==3.20.3`, Python 3.11, locked in `uv.lock`. The adapter
verifies the runtime TensorFlow matches the declared 2.15 line before
training and **fails loudly** on any drift.
Set `STREAM_SKIP_TF_GUARD=1` only for the fake-upstream unit tests.

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

**System requirements on the training backend:** `graphviz` (the upstream
accuracy test calls `tf.keras.utils.plot_model`; `pydot` is pip-installed via
the `tf` extra). On Colab: `!apt-get install -y graphviz`. `ffmpeg` is also
required for `edge-tts` mp3 -> wav conversion.

## Tests

```bash
python -m pytest
```

Deterministic — a fake upstream `model_train_eval.py` under
`tests/fake_upstream/` produces the run-dir outputs without GPU or network.
