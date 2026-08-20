"""qwen-llm-tts TTS engine adapter (ADR-044 §5, #205).

Engine id `qwen-llm-tts`, kind `llm-tts` (backend GPU). OpenAI-compatible
LLM-TTS endpoint (hosted qwen / vibe-voice / F5 via the shared HTTP machinery);
local-GPU runtimes are a follow-up. The module owns its adapter.
"""

from __future__ import annotations

from wake_train_kit.http_tts import OnlineHTTPEngineBase


class Engine(OnlineHTTPEngineBase):
    """LLM-TTS via an OpenAI-compatible endpoint."""

    id = "qwen-llm-tts"
    kind = "llm-tts"
    default_model = "qwen2.5-omni-7b"
