"""mimo-tts TTS engine adapter (ADR-044 §5, #205).

Engine id `mimo-tts`, kind `online-http-tts` (browser + backend). MiMo speech
synthesis v2.5 — OpenAI-compatible chat.completions (target text in the
`assistant` message, style/voice instruction in `user`; audio back as base64
pcm16). Shares the online HTTP machinery; the module owns its adapter.
"""

from __future__ import annotations

from wake_train_kit.http_tts import OnlineHTTPEngineBase


class Engine(OnlineHTTPEngineBase):
    """MiMo TTS (mimo.mi.com speech synthesis v2.5)."""

    id = "mimo-tts"
    kind = "online-http-tts"
    default_model = "mimo-v2.5-tts"
