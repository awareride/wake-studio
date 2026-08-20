"""piper TTS engine adapter (ADR-044 §5, #205).

Engine id `piper`, kind `classic-tts` (backend). Declared in the catalog; the
adapter lands with the openwakeword training path (local piper-sample-generator
runtime). Kept as an explicit, honest error until then.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from wake_train_kit.http_tts import GenerationError


class Engine:
    """Local Piper synthesis — pending the openwakeword path."""

    id = "piper"
    kind = "classic-tts"

    def synthesize(self, params: dict[str, Any], out_dir: Path, reporter: Any) -> dict[str, Any]:
        raise GenerationError(
            "piper TTS adapter is not implemented yet (#205); use edge-tts or "
            "an online HTTP TTS engine (e.g. mimo-tts)"
        )
