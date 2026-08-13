/**
 * Training console — stepper state machine (issue #105).
 *
 * Pure, headless step/state logic for the Training console stepper
 * (Configure → Connect backend → Run/monitor → Review, plan §1). No UI, no
 * storage — fully L1-testable. The stepper auto-advances to Review when a
 * job succeeds; all other navigation is manual.
 */

export type TrainingStepId = 'configure' | 'connect' | 'run' | 'review'

export interface TrainingStepDef {
  id: TrainingStepId
  /** Short label for stepper navigation. */
  label: string
  /** One-line purpose for the stepper header. */
  summary: string
  /** Contextual help lines for the help drawer (guide, not a tab). */
  help: string[]
}

export const STEP_ORDER: readonly TrainingStepId[] = [
  'configure',
  'connect',
  'run',
  'review',
]

export const STEP_DEFS: readonly TrainingStepDef[] = [
  {
    id: 'configure',
    label: 'Configure',
    summary: 'Set the wake phrase, target tier and training params.',
    help: [
      'Choose the wake phrase that will trigger the trained model.',
      'Target tier: MCU (TFLite-Micro, micro-wake-word) or app-class (ONNX, openWakeWord).',
      'Advanced params (epochs, augmentation, quantization) are optional — the defaults are safe.',
    ],
  },
  {
    id: 'connect',
    label: 'Connect backend',
    summary: 'Pick where training runs and connect to it.',
    help: [
      'Colab is the free path: open the module-owned notebook in your Google account, run it, and paste the Cloudflare tunnel URL here (ADR-023 amendment, issue #106).',
      'Self-hosted and cloud-provider backends land in a later Phase 5 slice — this step starts with Colab.',
      'The pasted URL stays in your browser only (client-side, localStorage).',
    ],
  },
  {
    id: 'run',
    label: 'Run / monitor',
    summary: 'Start training, watch status, and import the results bundle.',
    help: [
      'Start training in the module panel, or run the Colab notebook and download wake-studio-results.zip.',
      'Import Colab results validates the bundle manifest (metadata.json + provenance.json) client-side.',
      'The stepper auto-advances to Review when a job succeeds.',
    ],
  },
  {
    id: 'review',
    label: 'Review',
    summary: 'Inspect the finished job and its artifact.',
    help: [
      'Check the trained model, metrics (recall/accuracy), and license provenance.',
      'A user-owned license means the Phase 4 export gate treats the model as commercially clean.',
      'Test the model in-browser via the KWS panel (Load models), then export.',
    ],
  },
]

/** Lifecycle phase the stepper reasons about (normalized from job status). */
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
 * Whether manual "Next" is allowed from `step`. Configure→Connect→Run are
 * freely walkable; Run only leaves **auto**matically on job success
 * (plan T-7), and Review is terminal.
 */
export function canAdvance(step: TrainingStepId, phase: JobPhase): boolean {
  switch (step) {
    case 'configure':
    case 'connect':
      return true
    case 'run':
      return phase === 'succeeded'
    case 'review':
      return false
  }
}

/** Manual "Back" is allowed everywhere except the first step. */
export function canGoBack(step: TrainingStepId): boolean {
  return step !== 'configure'
}

/** The next step after `step`; undefined when `step` is terminal (Review). */
export function nextStepId(step: TrainingStepId): TrainingStepId | undefined {
  const i = STEP_ORDER.indexOf(step)
  return i >= 0 && i < STEP_ORDER.length - 1 ? STEP_ORDER[i + 1] : undefined
}

/**
 * Combine manual navigation with auto-advance on job success: returns the
 * step the console should move to, or undefined when it must stay put.
 */
export function advanceStep(
  step: TrainingStepId,
  phase: JobPhase,
): TrainingStepId | undefined {
  return canAdvance(step, phase) ? nextStepId(step) : undefined
}