"""NDJSON report-line parsing (docs/modules/training.md 4.4)."""

from __future__ import annotations

import json
from typing import Any

KNOWN_EVENTS = {
    "progress", "metrics", "log", "heartbeat", "checkpoint",
    "artifact", "error", "done",
}


def parse_report_line(line: str) -> dict[str, Any] | None:
    """Parse one train-script stdout line into a report dict.

    Returns None for non-report lines (plain logs, empty lines, comments),
    so plain stdout passthrough keeps working.
    """
    line = line.strip()
    if not line:
        return None
    try:
        obj = json.loads(line)
    except (ValueError, TypeError):
        return None
    if not isinstance(obj, dict):
        return None
    if obj.get("event") in KNOWN_EVENTS:
        return obj
    return None
