/**
 * Training console — stepper navigation (issue #105).
 *
 * Horizontal step indicator (Configure → Connect → Run → Review) with a
 * Summary line and Back/Next controls. Navigation is manual except the
 * auto-advance to Review on job success (plan T-7, issue #105). Uses the
 * pure step machine from the training module core (steps.ts).
 */

import {
  STEP_DEFS,
  STEP_ORDER,
  canAdvance,
  canGoBack,
  nextStepId,
  type JobPhase,
  type TrainingStepId,
} from '@wake-studio/module-training'
import { cn } from '../../components/cn'
import { IconChevronRight } from '../../components/icons'

export interface StepperNavProps {
  step: TrainingStepId
  phase: JobPhase
  onStepChange: (step: TrainingStepId) => void
  onHelp: (step: TrainingStepId) => void
}

/** Steps that may be clicked directly (current + completed ones). */
function clickable(step: TrainingStepId, current: TrainingStepId): boolean {
  return STEP_ORDER.indexOf(step) <= STEP_ORDER.indexOf(current)
}

export function StepperNav({ step, phase, onStepChange, onHelp }: StepperNavProps) {
  const currentIndex = STEP_ORDER.indexOf(step)
  const defs = STEP_DEFS.filter((d) => STEP_ORDER.includes(d.id))

  return (
    <div className="space-y-3">
      {/* Horizontal step pills. */}
      <nav aria-label="Training steps" className="flex flex-wrap items-center gap-1.5">
        {defs.map((def, i) => {
          const done = i < currentIndex
          const active = i === currentIndex
          return (
            <div key={def.id} className="flex items-center gap-1.5">
              {i > 0 && (
                <IconChevronRight className="h-3.5 w-3.5 text-ink-3" />
              )}
            <div
              key={def.id}
              className={cn(
                'group inline-flex items-center gap-1.5 rounded-full border py-1 pl-1.5 pr-1 text-xs font-medium transition-colors',
                active
                  ? 'border-brand-500/60 bg-brand-500/10 text-brand-400'
                  : done
                    ? 'border-line bg-surface-2 text-ink-2 hover:bg-surface-3'
                    : 'border-line bg-surface-1 text-ink-3',
              )}
            >
              <button
                type="button"
                onClick={() => clickable(def.id, step) && onStepChange(def.id)}
                disabled={!clickable(def.id, step)}
                aria-current={active ? 'step' : undefined}
                className={cn(
                  'inline-flex items-center gap-2',
                  !clickable(def.id, step) && 'cursor-not-allowed opacity-60',
                )}
              >
                <span
                  className={cn(
                    'flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold',
                    active ? 'bg-brand-500 text-ink-1' : done ? 'bg-success/20 text-success' : 'bg-surface-3 text-ink-3',
                  )}
                >
                  {done ? '✓' : i + 1}
                </span>
                {def.label}
              </button>
              <button
                type="button"
                aria-label={`Help: ${def.label}`}
                onClick={() => onHelp(def.id)}
                className={cn(
                  'rounded-full px-1 text-ink-3 hover:text-ink-1',
                  active ? 'opacity-80' : 'opacity-0 group-hover:opacity-100',
                )}
              >
                ?
              </button>
            </div>
            </div>
          )
        })}
      </nav>

      {/* Step summary + Back/Next. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm text-ink-2">
          {STEP_DEFS.find((d) => d.id === step)?.summary}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onStepChange(STEP_ORDER[currentIndex - 1])}
            disabled={!canGoBack(step)}
            className="rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-sm text-ink-2 transition-colors hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Back
          </button>
          {canAdvance(step, phase) && (
            <button
              type="button"
              onClick={() => {
                const next = nextStepId(step)
                if (next) onStepChange(next)
              }}
              className="rounded-lg bg-brand-500 px-4 py-1.5 text-sm font-medium text-ink-1 transition-colors hover:bg-brand-400"
            >
              Next
            </button>
          )}
        </div>
      </div>
    </div>
  )
}