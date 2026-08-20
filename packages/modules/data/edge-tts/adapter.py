"""edge-tts TTS engine adapter (ADR-044 §5, #205).

Engine id `edge-tts`, kind `classic-tts` (backend). Reuses the shared
`wake_train_kit.data_sources.build_edge_tts_kws_dataset` synthesis; this module
owns its adapter (loaded by wake_train_kit.generation via spec.meta.id).
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import wake_train_kit.data_sources as data_sources


class Engine:
    """Multi-language edge-tts synthesis (positives + unknown negatives + noise)."""

    id = "edge-tts"
    kind = "classic-tts"

    def synthesize(self, params: dict[str, Any], out_dir: Path, reporter: Any) -> dict[str, Any]:
        phrases = _as_list(params.get("phrases", []))
        if not phrases:
            from wake_train_kit.http_tts import GenerationError

            raise GenerationError("edge-tts requires at least one phrase")
        languages = _as_list(params.get("languages", ["en-US"]))
        unknown_words = _as_list(
            params.get("unknownWords", ["goodbye", "okay", "stop", "hello", "thanks"])
        )
        samples = int(params.get("samplesPerPhrase", 3) or 3)

        provenance = data_sources.build_edge_tts_kws_dataset(
            phrases,
            languages,
            out_dir,
            samples_per_phrase=samples,
            unknown_words=unknown_words,
            reporter=reporter,
        )

        labels: list[dict[str, Any]] = []
        for phrase in phrases:
            labels.append(
                {
                    "name": data_sources._sanitize_label(phrase),
                    "role": "positive",
                    "language": languages[0] if languages else None,
                    "source": "synthetic",
                }
            )
        for word in unknown_words:
            labels.append(
                {"name": data_sources._sanitize_label(word), "role": "unknown", "source": "synthetic"}
            )
        labels.append({"name": "_background_noise_", "role": "noise", "source": "synthetic"})
        return {"provenance": provenance, "labels": labels}


def _as_list(value: Any) -> list[str]:
    import re

    if value is None:
        return []
    if isinstance(value, str):
        return [v.strip() for v in re.split(r"[,;]", value) if v.strip()]
    if isinstance(value, (list, tuple)):
        return [str(v) for v in value]
    return []
