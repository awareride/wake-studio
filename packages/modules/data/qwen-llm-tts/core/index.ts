/**
 * qwen-llm-tts engine module - core exports.
 *
 * Spec-driven TTS engine (ADR-044 §5, #205): the module's spec.params render
 * its generation panel; the backend engine adapter lives in adapter.py and is
 * loaded at runtime by wake_train_kit.generation (the module owns its code,
 * like kws train adapters). This stub keeps the module a full ADR-025 member.
 */
export const engineId = 'qwen-llm-tts' as const
