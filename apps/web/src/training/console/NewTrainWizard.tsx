/**
 * Training wizard — New train (issue #105).
 *
 * Four steps: Choose model type → Configure → Choose train method → Ready.
 * The guide is mixed into each step panel (inline). The selected module's
 * OWN train params (spec.train.params) are rendered spec-driven by
 * TrainParamsPanel (kept mounted so values survive step navigation).
 *
 * The wizard runs in a modal dialog (TrainingConsole) so left-rail train
 * clicks cannot interrupt it. The Ready step's CTA is honest per method:
 * Colab cannot be started from here — the button saves/confirms the train
 * (the run happens in the user's Colab session; results come back via the
 * details pane); subprocess/ci label it "Start train" for the future.
 */

import { useCallback, useMemo, useState } from 'react'
import {
  STEP_DEFS,
  STEP_ORDER,
  advanceStep,
  canAdvance,
  canGoBack,
  nextStepId,
  trainPanelSpec,
  type TrainMethodId,
  type TrainingStepId,
} from '@wake-studio/module-training'
import { TrainParamsPanel } from '@wake-studio/module-training/web'
import { cn } from '../../components/cn'
import { IconChevronRight } from '../../components/icons'
import { findTrainableModule, type TrainableModule } from '../train-modules'
import { InlineGuide } from './InlineGuide'
import { ModelTypeStep } from './ModelTypeStep'
import { ConfigStep } from './ConfigStep'
import { MethodStep } from './MethodStep'
import { ReadyStep } from './ReadyStep'

export interface NewTrainWizardProps {
  modules: TrainableModule[]
  /** Called with the finalized train when the user confirms (Start/Save). */
  onStarted: (moduleId: string, method: TrainMethodId, params: Record<string, string>) => void
  onCancel: () => void
}

export function NewTrainWizard({ modules, onStarted, onCancel }: NewTrainWizardProps) {
  const [step, setStep] = useState<TrainingStepId>('model')
  const [moduleId, setModuleId] = useState<string | null>(null)
  const [method, setMethod] = useState<TrainMethodId | null>(null)
  const [params, setParams] = useState<Record<string, string>>({})
  const [starting, setStarting] = useState(false)

  const module = findTrainableModule(modules, moduleId ?? undefined)
  const def = STEP_DEFS.find((d) => d.id === step) ?? STEP_DEFS[0]
  const next = nextStepId(step)

  // The panel spec for the selected module's OWN train params (spec-driven,
  // ADR-025) — built once per module so the generated panel keeps its state
  // across renders.
  const trainSpec = useMemo(
    () =>
      module
        ? trainPanelSpec({
            id: module.id,
            name: module.name,
            category: module.category,
            license: module.license,
            params: module.train.params,
          })
        : null,
    [module],
  )

  // Next is gated on the step's selection: a model type on step 1, a
  // method on step 3; Configure and Ready always pass.
  const canNext =
    canAdvance(step) &&
    (step === 'model' ? moduleId !== null : step === 'method' ? method !== null : true)

  const selectModule = useCallback((id: string) => {
    setModuleId(id)
    setMethod(null) // a different module may not support the same method
  }, [])

  const handleStart = useCallback(() => {
    if (!module || !method) return
    setStarting(true)
    onStarted(module.id, method, params)
  }, [module, method, params, onStarted])

  return (
    <div className="space-y-5">
      {/* Wizard header. */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-ink-1">New train</h3>
          <p className="mt-0.5 text-xs text-ink-3">{def.summary}</p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-line bg-surface-2 px-2.5 py-1 text-xs text-ink-3 transition-colors hover:bg-surface-3 hover:text-ink-1"
        >
          Cancel
        </button>
      </div>

      {/* Step pills. */}
      <nav aria-label="New train steps" className="flex flex-wrap items-center gap-1.5">
        {STEP_ORDER.map((id, i) => {
          const active = id === step
          const done = STEP_ORDER.indexOf(step) > i
          const d = STEP_DEFS.find((s) => s.id === id)!
          return (
            <div key={id} className="flex items-center gap-1.5">
              {i > 0 && <IconChevronRight className="h-3.5 w-3.5 text-ink-3" />}
              <span
                className={cn(
                  'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium',
                  active
                    ? 'border-brand-500/60 bg-brand-500/10 text-brand-400'
                    : done
                      ? 'border-line bg-surface-2 text-ink-2'
                      : 'border-line bg-surface-1 text-ink-3',
                )}
              >
                <span
                  className={cn(
                    'flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold',
                    active
                      ? 'bg-brand-500 text-ink-1'
                      : done
                        ? 'bg-success/20 text-success'
                        : 'bg-surface-3 text-ink-3',
                  )}
                >
                  {done ? '✓' : i + 1}
                </span>
                {d.label}
              </span>
            </div>
          )
        })}
      </nav>

      {/* Guide mixed into the step panel. */}
      <InlineGuide lines={def.help} />

      {/* Step content. */}
      {step === 'model' && (
        <ModelTypeStep modules={modules} selectedId={moduleId} onSelect={selectModule} />
      )}

      {step === 'config' && module && <ConfigStep module={module} />}

      {step === 'method' && module && (
        <MethodStep module={module} selected={method} onSelect={setMethod} />
      )}

      {step === 'ready' && module && method && (
        <ReadyStep module={module} method={method} params={params} />
      )}

      {/* The module's own train params (spec-driven, ADR-025): kept mounted
          so values survive step navigation; params render on Configure. */}
      <div className={step === 'config' ? '' : 'hidden'}>
        {trainSpec && <TrainParamsPanel spec={trainSpec} onValuesChange={setParams} />}
      </div>

      {/* Back / Next — the final step replaces Next with Save/Start in the
          same position (issue #105). */}
      <div className="flex items-center justify-between border-t border-line pt-4">
        <button
          type="button"
          onClick={() => setStep(STEP_ORDER[STEP_ORDER.indexOf(step) - 1])}
          disabled={!canGoBack(step)}
          className="rounded-lg border border-line bg-surface-2 px-4 py-1.5 text-sm text-ink-2 transition-colors hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Back
        </button>
        {next ? (
          <button
            type="button"
            onClick={() => setStep(advanceStep(step) ?? step)}
            disabled={!canNext}
            className="rounded-lg bg-brand-500 px-5 py-1.5 text-sm font-medium text-ink-1 transition-colors hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Next
          </button>
        ) : (
          <button
            type="button"
            onClick={handleStart}
            disabled={starting}
            className="rounded-lg bg-brand-500 px-5 py-1.5 text-sm font-semibold text-ink-1 transition-colors hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {starting ? 'Saving…' : method === 'colab' ? 'Save' : 'Start train'}
          </button>
        )}
      </div>

      {step === 'ready' && method === 'colab' && (
        <p className="text-[11px] leading-relaxed text-ink-3">
          Save just confirms this train here — the run happens in your own Colab session (run the
          notebook, then bring results back in the train details pane: tunnel URL, or download +
          submit the results zip).
        </p>
      )}
    </div>
  )
}