/**
 * Training console — wizard step machine (issue #105).
 *
 * Pure, headless step/state logic for the "New train" wizard:
 * Choose model type → Configure → Choose train method → Ready to start.
 * No UI, no storage — fully L1-testable. Guidance text for each step is
 * rendered inline inside the step panels (guide is mixed in, not a drawer).
 */

export type TrainingStepId = 'model' | 'config' | 'method' | 'ready'

export interface TrainingStepDef {
  id: TrainingStepId
  /** Short label for stepper navigation. */
  label: string
  /** One-line purpose for the stepper header. */
  summary: string
  /** Inline guidance shown inside the step panel (guide mixed in). */
  help: string[]
}

export const STEP_ORDER: readonly TrainingStepId[] = [
  'model',
  'config',
  'method',
  'ready',
]

export const STEP_DEFS: readonly TrainingStepDef[] = [
  {
    id: 'model',
    label: 'Choose model type',
    summary: 'Pick the module you want to train.',
    help: [
      'Each trainable module declares its own train config in its spec (ADR-025): what it produces (ONNX/TFLite) and how training runs.',
      'KWS openwakeword = app-class wake-word model (ONNX). KWS streaming = streaming-aware model (TFLite). RNNoise = noise suppression (ONNX).',
      'Only modules with a spec.train entry appear here.',
    ],
  },
  {
    id: 'config',
    label: 'Configure',
    summary: 'Set the training params for the chosen module.',
    help: [
      'Params come from the selected module\'s own spec.train.params (spec-driven, ADR-025) — every module declares its own train knobs.',
      'The module card shows the differences from its spec.train: notebook or script, invocation methods, outputs.',
      'Defaults are safe — you can usually keep them.',
    ],
  },
  {
    id: 'method',
    label: 'Choose train method',
    summary: 'Pick where training runs, from the methods the module supports.',
    help: [
      'The methods come from the module\'s spec.train.invocation: Google Colab (free GPU, your account), Self-hosted service (local endpoint), CI (GitHub Actions).',
      'Colab is the v1 path: open the module-owned notebook, run it, and optionally paste the Cloudflare tunnel URL (ADR-023 amendment, issue #106) for direct control.',
      'Method-specific config stays client-side only.',
    ],
  },
  {
    id: 'ready',
    label: 'Ready to start',
    summary: 'Review the train, then start it.',
    help: [
      'For Colab: the module-owned .ipynb notebook is shown for review — you can download it or open it in Colab.',
      'Starting opens this train\'s review (status + results). Training never runs in the browser (ADR-013).',
      'A user-owned trained model (provenance.json) is commercially clean for export (Phase 4 license gate).',
    ],
  },
]

/** Lifecycle phase the console reasons about (normalized from job status). */
export type JobPhase = 'idle' | 'running' | 'succeeded' | 'failed' | 'canceled'

/**
 * Normalize a raw job status (or any value) into a phase. Unknown/absent
 * values map to 'idle' — nothing has run yet.
 */
export function jobPhase(status: unknown): JobPhase {
  switch (status) {
    case 'succeeded':
      return 'succeeded'
    case 'failed':
      return 'failed'
    case 'canceled':
      return 'canceled'
    case 'queued':
    case 'running':
      return 'running'
    default:
      return 'idle'
  }
}

/**
 * Whether manual "Next" is allowed from `step`. The first three steps walk
 * freely; `ready` has no Next — it is where the user presses Start.
 */
export function canAdvance(step: TrainingStepId): boolean {
  return step !== 'ready'
}

/** Manual "Back" is allowed everywhere except the first step. */
export function canGoBack(step: TrainingStepId): boolean {
  return step !== 'model'
}

/** The next step after `step`; undefined when `step` is terminal (ready). */
export function nextStepId(step: TrainingStepId): TrainingStepId | undefined {
  const i = STEP_ORDER.indexOf(step)
  return i >= 0 && i < STEP_ORDER.length - 1 ? STEP_ORDER[i + 1] : undefined
}

/** Advance one step (wizard navigation; ready is terminal). */
export function advanceStep(step: TrainingStepId): TrainingStepId | undefined {
  return canAdvance(step) ? nextStepId(step) : undefined
}