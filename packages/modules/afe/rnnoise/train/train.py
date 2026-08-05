#!/usr/bin/env python3
"""RNNoise module train stub (ADR-028).

RNNoise weights are frozen (xiph/rnnoise); WakeStudio does not retrain them.
This script satisfies the module train contract by producing the run metadata
that the local service / CI expect, and exits 0 so tooling can exercise the
full train pipeline end-to-end.

Phase 5 will replace this with a real fine-tuning entrypoint if a target-domain
fine-tune is added (see train/README.md).
"""

import json
import os
import sys
from pathlib import Path

OUT_DIR = Path(os.environ.get("MODULE_OUT_DIR", "out"))


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    metrics = {
        "module": "rnnoise",
        "status": "no-op",
        "reason": "RNNoise weights are frozen; no training in WakeStudio (ADR-002).",
        "outputs": {
            "checkpoint": None,
            "metrics": "out/metrics.json",
        },
    }
    (OUT_DIR / "metrics.json").write_text(json.dumps(metrics, indent=2))
    print(f"[rnnoise train] wrote {OUT_DIR / 'metrics.json'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
