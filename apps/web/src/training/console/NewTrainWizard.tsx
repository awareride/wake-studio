/**
 * Training wizard — New train (issue #105).
 *
 * Four steps: Choose model type → Configure → Choose train method → Ready.
 * The guide is mixed into each step panel (inline). The training module's
 * generated panel stays mounted across steps (params survive navigation);
 * it renders its params on the Configure step and is hidden elsewhere. The
 * Ready step's Start button creates the job and opens its review.
 */

import { useCallback, useState } from 'react'
import {
  STEP_DEFS,
  STEP_ORDER,
  advanceStep,
  canAdvance,
  canGoBack,
  nextStepId,
  type TrainMethodId,
  type TrainingStepId,
} from '@wake-studio/module-training'
import { TrainingModulePanel } from '@wake-studio/module-training/web'
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
  /** Persisted method urls (client-side only) — colab tunnel / endpoint. */
  tunnelUrl: string
  onChangeTunnelUrl: (url: string) => void
  endpointUrl: string
  onChangeEndpointUrl: (url: string) => void
  /** Called with the finalized train when the user presses Start. */
  onStarted: (moduleId: string, method: TrainMethodId, params: Record<string, string>) => void
  onCancel: () => void
}

export function NewTrainWizard({
  modules,
  tunnelUrl,
  onChangeTunnelUrl,
  endpointUrl,
  onChangeEndpointUrl,
  onStarted,
  onCancel,
}: NewTrainWizardProps) {
  const [step, setStep] = useState<TrainingStepId>('model')
  const [moduleId, setModuleId] = useState<string | null>(null)
  const [method, setMethod] = useState<TrainMethodId | null>(null)
  const [params, setParams] = useState<Record<string, string>>({})
  const [starting, setStarting] = useState(false)

  const module = findTrainableModule(modules, moduleId ?? undefined)
  const def = STEP_DEFS.find((d) => d.id === step) ?? STEP_DEFS[0]
  const next = nextStepId(step)

  // Next is gated on the step's selection: a model type on step 1, a
  // method on step 3; Configure and Ready always pass.
  const canNext =
    canAdvance(step) &&
    (step === 'model' ? moduleId !== null : step === 'method' ? method !== null : true)

  const selectModule = useCallback((id: string) => {
    setModuleId(id)
    setMethod(null) // a different module may not support the same method
  }, [])

  const selectMethod = useCallback((id: TrainMethodId) => {
    setMethod(id)
  }, [])

  const handleStart = useCallback(() => {
    if (!module || !method) return
    setStarting(true)
    onStarted(module.id, method, params)
  }, [module, method, params, onStarted])

  const urlValue = method === 'colab' ? tunnelUrl : method === 'subprocess' ? endpointUrl : ''
  const urlChange =
    method === 'colab'
      ? onChangeTunnelUrl
      : method === 'subprocess'
        ? onChangeEndpointUrl
        : () => {}

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
        <MethodStep
          module={module}
          selected={method}
          onSelect={selectMethod}
          urlValue={urlValue}
          onChangeUrl={urlChange}
        />
      )}

      {step === 'ready' && module && method && (
        <ReadyStep
          module={module}
          method={method}
          params={params}
          onStart={handleStart}
          starting={starting}
        />
      )}

      {/* The module panel (spec-driven params, ADR-025): kept mounted so
          params survive step navigation; params render on Configure. */}
      <div className={step === 'config' ? '' : 'hidden'}>
        <TrainingModulePanel sections={['params']} onValuesChange={setParams} />
      </div>

      {/* Back / Next. */}
      <div className="flex items-center justify-between border-t border-line pt-4">
        <button
          type="button"
          onClick={() => setStep(STEP_ORDER[STEP_ORDER.indexOf(step) - 1])}
          disabled={!canGoBack(step)}
          className="rounded-lg border border-line bg-surface-2 px-4 py-1.5 text-sm text-ink-2 transition-colors hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Back
        </button>
        {next && (
          <button
            type="button"
            onClick={() => setStep(advanceStep(step) ?? step)}
            disabled={!canNext}
            className="rounded-lg bg-brand-500 px-5 py-1.5 text-sm font-medium text-ink-1 transition-colors hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Next
          </button>
        )}
      </div>
    </div>
  )
}