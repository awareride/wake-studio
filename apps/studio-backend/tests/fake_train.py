#!/usr/bin/env python3
"""Fake train script for studio-backend tests.

Emits the NDJSON reporting protocol (docs/modules/training.md 4.4) so the
job manager's queue/start/pause/resume/cancel/heartbeat paths can be tested
deterministically without GPU time.

Params arrive as env vars (the notebook convention): WAKE_<KEY> per job param.
"""
import json
import os
import signal
import sys
import time

OUT = os.environ.get("WAKE_OUT_DIR", ".")
STEPS = int(os.environ.get("WAKE_STEPS", "5"))
SLEEP = float(os.environ.get("WAKE_SLEEP", "0.05"))
STALL = os.environ.get("WAKE_STALL") == "1"
FAIL = os.environ.get("WAKE_FAIL") == "1"


def emit(obj):
    print(json.dumps(obj), flush=True)


def handle_term(signum, frame):
    # checkpoint-and-hold: upstream scripts save state on SIGTERM
    os.makedirs(OUT, exist_ok=True)
    ck = os.path.join(OUT, "checkpoint.pt")
    with open(ck, "w") as f:
        f.write("step checkpoint\n")
    emit({"event": "checkpoint", "path": ck})
    emit({"event": "log", "level": "info", "message": "paused by SIGTERM (checkpoint saved)"})
    sys.exit(130)


signal.signal(signal.SIGTERM, handle_term)

emit({"event": "log", "level": "info",
      "message": f"fake train start steps={STEPS} stall={STALL} fail={FAIL}"})

if STALL:
    time.sleep(3600)  # no output at all -> heartbeat timeout marks the job failed
    sys.exit(0)

for i in range(1, STEPS + 1):
    time.sleep(SLEEP)
    emit({"event": "progress", "step": i, "total": STEPS,
          "progress": i / STEPS, "message": f"step {i}"})
    emit({"event": "metrics", "loss": round(1.0 / i, 4), "step": i})
    if i % 2 == 0:
        emit({"event": "heartbeat"})

os.makedirs(OUT, exist_ok=True)
model = os.path.join(OUT, "model.onnx")
with open(model, "wb") as f:
    f.write(b"fake-model-bytes")
emit({"event": "artifact", "path": model})

if FAIL:
    emit({"event": "error", "message": "training failed (simulated)"})
    sys.exit(1)

emit({"event": "done", "exitCode": 0})
