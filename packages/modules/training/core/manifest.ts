import type { TrainingJob } from './job'

type TrainingJobBackend = TrainingJob['backend']

/**
 * Training module - artifact bundle manifest (docs/modules/training.md §4).
 *
 * ONE manifest serves all backends (local-service / cloud / Colab) so the PWA
 * has a single importer that validates + imports any trained model. The
 * provenance is the license-gate input (goal.plan Phase 4): a trained model is
 * user-owned / commercially clean.
 */

export interface ArtifactBundleMetadata {
  jobId: string
  moduleId: string
  backend: TrainingJobBackend
  provider?: string
  params: Record<string, string>
  trainedAtMs: number
}

export interface ArtifactProvenance {
  /** 'user-owned' = trained = commercially clean; else the third-party license. */
  license: 'user-owned' | string
  sourceData?: Array<{ name: string; license: string; source: string }>
  notes?: string
}

/** The standard bundle layout (wake-studio-results/<job-id>/). */
export interface ArtifactBundle {
  jobId: string
  files: {
    /** model.onnx | model.tflite */
    model?: Uint8Array
    metrics?: Record<string, number>
    metadata: ArtifactBundleMetadata
    provenance: ArtifactProvenance
    /** AFE/KWS/Few-Shot config snapshot used for training. */
    configSnapshot?: Record<string, unknown>
  }
}

/**
 * Output-normalization adapter (docs/modules/training.md §4.3).
 *
 * `standardize-results` is the single importer: given an upstream run's
 * output dir (ANY shape - openWakeWord, micro-wake-word, wakeforge/ww_trainer,
 * ...), it finds the model + metrics + provenance and produces the standard
 * bundle. The upstream artifact is never changed (human decision 2026-08-05:
 * we adapt to the script, not vice versa).
 */
export interface ResultsAdapter {
  /** Adapter id (e.g. "standardize-results"). */
  readonly id: string
  /**
   * Normalize an upstream run's output dir into the standard bundle.
   * @param runDir   the upstream script's output directory (any shape)
   * @param options  adapterOptions from spec/train (modelRegex, metricsParser, ...)
   */
  standardize(runDir: string, options?: Record<string, unknown>): Promise<ArtifactBundle>
}

/** Validate an imported bundle against the manifest shape. */
export function validateBundle(bundle: Partial<ArtifactBundle>): bundle is ArtifactBundle {
  return (
    typeof bundle.jobId === 'string' &&
    !!bundle.files?.metadata &&
    !!bundle.files?.provenance
  )
}
