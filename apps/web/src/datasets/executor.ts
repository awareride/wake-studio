/**
 * Datasets — executor decision (ADR-044 §8.1, #208).
 *
 * One generation pipeline, TWO executors (locked, human decision #208). The
 * console picks the executor from (a) the engine's declared `runtime`
 * (dataset-engines.json) and (b) whether a studio-backend is connected:
 *
 *   - engine is browser-capable (`runtime` includes 'browser') AND no backend
 *     -> BROWSER executor (client-side fetch TTS -> Web Audio -> canonical
 *        zip; cloud = direct browser push).
 *   - a backend is connected -> BACKEND executor (POST /jobs
 *        dataset-generate; persists to the store; cloud via dataset-storage
 *        job with job-scoped secrets).
 *   - engine is backend-only AND no backend -> unavailable (clear reason).
 *
 * Pure + L1-testable.
 */

import { isBrowserCapable, type TTSEngineDescriptor } from '@wake-studio/module-dataset'

export type GenerationExecutor = 'browser' | 'backend'

export interface ExecutorDecision {
  executor: GenerationExecutor | null
  /** Why the engine cannot run (null when an executor is chosen). */
  unavailable?: string
  /** Human summary shown in the wizard's save-destination step. */
  note: string
}

/** Resolve the executor for an engine given studio-backend connectivity. */
export function resolveExecutor(
  engine: TTSEngineDescriptor,
  backendConnected: boolean,
): ExecutorDecision {
  const browserCapable = isBrowserCapable(engine)

  if (!browserCapable && !backendConnected) {
    return {
      executor: null,
      unavailable:
        `“${engine.name}” needs a studio-backend to run — connect one in the Backends menu ` +
        `(or pick a browser-capable engine such as MiMo TTS).`,
      note: 'Backend-only engine: requires a connected studio-backend.',
    }
  }
  if (backendConnected) {
    return {
      executor: 'backend',
      note:
        browserCapable
          ? 'Runs on the connected studio-backend (persists to the backend store, full actions + cloud upload).'
          : 'Runs on the connected studio-backend (backends store the generated dataset).',
    }
  }
  return {
    executor: 'browser',
    note:
      'No studio-backend connected — this engine runs in the browser (online HTTP TTS → canonical zip). ' +
      'The dataset is saved locally; cloud push is a direct browser upload.',
  }
}

/** True when the backend path is taken for this engine + connectivity. */
export function isBackendExecutor(engine: TTSEngineDescriptor, backendConnected: boolean): boolean {
  return resolveExecutor(engine, backendConnected).executor === 'backend'
}
