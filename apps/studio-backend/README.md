# studio-backend — WakeStudio self-hosted training service (ADR-005 + ADR-036)

Python/FastAPI **job-manager service** for module train scripts. One codebase,
two launchers:

- **Local / self-hosted:** `uv run wake-service` (the ADR-005 PyInstaller /
  Docker engine target).
- **Google Colab:** the same service started by a notebook cell, exposed via a
  Cloudflare tunnel (`cloudflared`) — **launcher glue only**, no tunnel code
  lives in this service (ADR-023 amendment).

The PWA drives **jobs only** (`POST /jobs`, …) — the legacy module-train
endpoints are retired from the PWA contract (ADR-036 §2). Contract:
`docs/modules/training.md` §3.

## Quickstart

```bash
uv sync --project apps/training-service          # install deps into .venv
uv run --project apps/studio-backend wake-service --registry apps/studio-backend/registry.json
```

Defaults: `127.0.0.1:4824`, single-concurrency, SQLite at
`data/wake-service.db`, artifacts in `data/artifacts/`.

> Without `--token` the service is **open** (localhost dev). The Colab
> launcher always sets `--token` (mutating endpoints require it; reads stay
> open — the tunnel URL is unguessable but public, ADR-036 §5).

## CLI

| Flag | Default | Meaning |
|---|---|---|
| `--host` / `--port` | `127.0.0.1` / `4824` | bind address (env `WAKE_SERVICE_HOST` / `WAKE_SERVICE_PORT`) |
| `--concurrency N` | `1` | max simultaneously running jobs (one GPU) |
| `--token TOKEN` | env `WAKE_SERVICE_TOKEN` | required on mutating endpoints |
| `--heartbeat-timeout S` | `300` | a job with no report line for S seconds is marked `failed` |
| `--db PATH` | `data/wake-service.db` | SQLite job store (survives restarts) |
| `--artifacts-dir DIR` | `data/artifacts` | sha256-indexed trained artifacts |
| `--max-artifacts-mb N` | `0` (unlimited) | prune oldest artifacts above this size |
| `--registry PATH` | `registry.json` | module → train-command mapping |

## Registry

`registry.json` maps a module id to how its train script is invoked:

```jsonc
{
  "kws-openwakeword": {
    "cwd": "../../packages/modules/kws/openwakeword/train",
    "engine": "uv",                    // uv = `uv run <entry>` (ADR-028); direct = python
    "entry": "train/train.py",
    "args": ["--epochs", "{params.epochs}"],   // optional templating
    "env": { "DATA_DIR": "{env.DATA_DIR}" }    // optional templating
  }
}
```

Job params are also injected as env vars (`WAKE_PARAMS` JSON + one
`WAKE_<UPPER_KEY>` per param) — the notebook env convention
(`docs/modules/training.md` §4.1).

## API

```
GET    /health                       liveness + GPU info + job counts
GET    /modules                      registry catalog
GET    /jobs                         list jobs
POST   /jobs                         create + enqueue            [token]
GET    /jobs/{id}                    status + progress + metrics
POST   /jobs/{id}/start              start / resume              [token]
POST   /jobs/{id}/pause              checkpoint-and-hold         [token]
POST   /jobs/{id}/resume             resume from checkpoint      [token]
POST   /jobs/{id}/cancel             cancel (keep partials)      [token]
DELETE /jobs/{id}                    delete job + artifacts      [token]
GET    /jobs/{id}/logs               log lines
GET    /artifacts/{job}/{name}       download (ETag + X-Checksum-Sha256)
GET    /stream                       SSE job events (polling fallback)
```

Execution model: **each job is a child OS process**; the stdout pipe is the
IPC channel. Train scripts emit **NDJSON report lines**
(`docs/modules/training.md` §4.4): `progress`, `metrics`, `log`, `heartbeat`,
`checkpoint`, `artifact`, `error`, `done`. Use the `wake_train_kit.report`
`Reporter` for free:

```python
from wake_train_kit.report import Reporter
r = Reporter()
r.progress(step=3, total=7, progress=0.42, message="augmenting clips")
r.artifact("out/model.onnx")
r.done()
```

## Tests

```bash
uv run --project apps/studio-backend pytest
```

Deterministic, no GPU: a fake train script (`tests/fake_train.py`) emits the
NDJSON protocol; the suite covers lifecycle, queueing, pause/resume
(checkpoint), cancel, heartbeat-stall, failure, restart persistence, auth,
artifacts and SSE.
