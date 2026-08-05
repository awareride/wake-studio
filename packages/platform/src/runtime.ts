/**
 * Global model-runtime abstraction (ADR-002 amendment).
 *
 * A *model runtime* is the engine that actually executes a model's inference
 * (ONNX via onnxruntime-web, browser-native weights via @xenova/transformers,
 * or ExecuTorch WASM for the heaviest on-device / browser targets). This type is
 * intentionally GLOBAL - every module (AFE front-ends, KWS detection backends,
 * the PLiX Few-Shot encoder, and any future model) selects its runtime from
 * this single union, so the choice can be made per model / per deployment
 * without each module inventing its own enum.
 *
 * The union is open-ended (a literal union today, but call sites accept the
 * type rather than hard-coding strings) so new runtimes - e.g. `executorch` - can
 * be added in one place. The default for browser targets is `'onnx'`.
 *
 * Moved from `apps/web/src/runtime.ts` (module-migration §6.3a): the runtime
 * abstraction is a platform capability (Q-P1), consumed by AFE/KWS/PLiX modules.
 */

/** Inference runtime used to execute a model. */
export type ModelRuntime = 'onnx' | 'transformers' | 'executorch'

/** The runtime used when no explicit hint is provided. */
export const DEFAULT_MODEL_RUNTIME: ModelRuntime = 'onnx'

/** Human-readable label for a runtime (UI / logs). */
export const RUNTIME_LABELS: Record<ModelRuntime, string> = {
  onnx: 'ONNX (onnxruntime-web)',
  transformers: 'Transformers.js (browser-native, no ONNX)',
  executorch: 'ExecuTorch (WASM)',
}
