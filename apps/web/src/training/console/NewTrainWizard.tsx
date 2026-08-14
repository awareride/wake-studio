/**
 * Training wizard — New train, full panel of the Training view (issue #105).
 *
 * Four steps: Choose model type → Configure → Choose train method → Ready.
 * The guide is mixed into each step (collapsed by default). The selected
 * module's OWN train params (spec.train.params) are rendered spec-driven by
 * TrainParamsPanel (kept mounted so values survive step navigation).
 *
 * Layout: header + step pills pinned, Back/Next/Save pinned at the bottom —
 * only the inner content scrolls. The notebook Review is a sub-panel (Back
 * preserves the wizard state). Leaving (Cancel or another menu) while the
 * wizard has progress asks for confirmation.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@radix-ui/themes'
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
import { useAppSettings } from '../../settings'
import { TRAIN_NEW_HASH_PREFIX, trainNewReviewFromHash, trainNewStepFromHash } from '../../router'
import { findTrainableModule, type TrainableModule } from '../train-modules'
import { ConfirmDialog } from './ConfirmDialog'
import { InlineGuide } from './InlineGuide'
import { ModelTypeStep } from './ModelTypeStep'
import { ConfigStep } from './ConfigStep'
import { MethodStep } from './MethodStep'
import { ReadyStep } from './ReadyStep'
import { NotebookReviewView } from './NotebookReviewView'
import { trainInputFile } from './train-files'

export interface NewTrainWizardProps {
  modules: TrainableModule[]
  /** Called with the finalized train when the user confirms (Save/Start).
   *  backendId is set when the Studio-backend method picked a managed backend. */
  onStarted: (
    moduleId: string,
    method: TrainMethodId,
    params: Record<string, string>,
    backendId?: string,
  ) => void
  onCancel: () => void
  /** Notified when the wizard gains/loses unsaved progress (nav guard). */
  onDirtyChange?: (dirty: boolean) => void
}

export function NewTrainWizard({
  modules,
  onStarted,
  onCancel,
  onDirtyChange,
}: NewTrainWizardProps) {
  const [step, setStep] = useState<TrainingStepId>('model')
  const [moduleId, setModuleId] = useState<string | null>(null)
  const [method, setMethod] = useState<TrainMethodId | null>(null)
  const [backendId, setBackendId] = useState<string | null>(null)
  const [params, setParams] = useState<Record<string, string>>({})
  const [starting, setStarting] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const { backends } = useAppSettings()

  // Wizard steps are hash-encoded (`#/training/new[/<step>]`, issue #136):
  // every step is its own history entry, so browser back/forward walk the
  // steps instead of leaving the Training view. Hash changes sync the step
  // and the notebook review sub-panel (`#/training/new/<step>/review`).
  useEffect(() => {
    const onHash = () => {
      const s = trainNewStepFromHash(window.location.hash)
      setStep(STEP_ORDER.includes(s as TrainingStepId) ? (s as TrainingStepId) : 'model')
      setReviewing(trainNewReviewFromHash(window.location.hash))
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  /** Advance a step as a forward history entry (browser back can undo it). */
  const goNext = useCallback(() => {
    const n = advanceStep(step) ?? step
    setStep(n)
    window.location.hash = `#${TRAIN_NEW_HASH_PREFIX}/${n}`
  }, [step])

  /** Go back one step by popping history — never push (issue #136). */
  const goBack = useCallback(() => {
    window.history.back()
  }, [])

  const module = findTrainableModule(modules, moduleId ?? undefined)
  const def = STEP_DEFS.find((d) => d.id === step) ?? STEP_DEFS[0]
  const next = nextStepId(step)
  const dirty = step !== 'model' || moduleId !== null || method !== null

  // Report unsaved progress to the console (leave-guard on other menus).
  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])

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

  const reviewFile = useMemo(
    () => (module && method ? trainInputFile(module, method) : null),
    [module, method],
  )

  const canNext =
    canAdvance(step) &&
    (step === 'model'
      ? moduleId !== null
      : step === 'method'
        ? method !== null && (method !== 'studio-backend' || backendId !== null)
        : true)

  const selectModule = useCallback((id: string) => {
    setModuleId(id)
    setMethod(null)
    setBackendId(null)
  }, [])

  const selectMethod = useCallback((m: TrainMethodId) => {
    setMethod(m)
    setBackendId(null)
  }, [])

  const handleStart = useCallback(() => {
    if (!module || !method) return
    setStarting(true)
    onStarted(module.id, method, params, backendId ?? undefined)
  }, [module, method, params, backendId, onStarted])

  const requestCancel = useCallback(() => {
    if (dirty) setConfirmCancel(true)
    else onCancel()
  }, [dirty, onCancel])

  if (reviewing && reviewFile) {
    return (
      <NotebookReviewView
        fileName={reviewFile.fileName}
        rawUrl={reviewFile.rawUrl ?? ''}
        onBack={() => {
          // Pop the review entry (`#/training/new/<step>/review`) — the step
          // entry below it restores the wizard state (issue #136).
          window.history.back()
        }}
        personalize={
          module && reviewFile.kind === 'notebook'
            ? { params: module.train.params ?? [], values: params }
            : undefined
        }
      />
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {/* Wizard header + step pills (pinned). */}
      <div className="flex shrink-0 items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-ink-1">New train</h3>
          <p className="mt-0.5 text-xs text-ink-3">{def.summary}</p>
        </div>
        <Button
          type="button"
          onClick={requestCancel}
          variant="outline"
          size="1"
          className="text-xs"
        >
          Cancel
        </Button>
      </div>

      <nav aria-label="New train steps" className="flex shrink-0 flex-wrap items-center gap-1.5">
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
                    ? 'border-brand-9/60 bg-brand-9/10 text-brand-11'
                    : done
                      ? 'border-line bg-surface-2 text-ink-2'
                      : 'border-line bg-surface-1 text-ink-3',
                )}
              >
                <span
                  className={cn(
                    'flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold',
                    active
                      ? 'bg-brand-9 text-ink-1'
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

      {/* Scrollable content. */}
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
        <InlineGuide lines={def.help} />

        {step === 'model' && (
          <ModelTypeStep modules={modules} selectedId={moduleId} onSelect={selectModule} />
        )}

        {step === 'config' && module && <ConfigStep module={module} />}

        {step === 'method' && module && (
          <MethodStep
            module={module}
            selected={method}
            onSelect={selectMethod}
            backends={backends}
            selectedBackendId={backendId}
            onSelectBackend={setBackendId}
          />
        )}

        {step === 'ready' && module && method && (
          <ReadyStep
            module={module}
            method={method}
            params={params}
            backend={backends.find((b) => b.id === backendId) ?? null}
            onReview={() => {
              // The review is its own history entry (issue #136): browser back
              // returns to the Ready step.
              window.location.hash = `#${TRAIN_NEW_HASH_PREFIX}/ready/review`
            }}
          />
        )}

        {/* The module's own train params (spec-driven, ADR-025): kept mounted
            so values survive step navigation; params render on Configure. */}
        <div className={step === 'config' ? '' : 'hidden'}>
          {trainSpec && <TrainParamsPanel spec={trainSpec} onValuesChange={setParams} />}
        </div>
      </div>

      {/* Pinned footer: Back / Next — the final step replaces Next with
          Save/Start in the same position (issue #105). */}
      <div className="shrink-0 space-y-2 border-t border-line pt-4">
        <div className="flex items-center justify-between">
          <Button
            type="button"
            onClick={goBack}
            disabled={!canGoBack(step)}
            variant="outline"
            size="2"
          >
            Back
          </Button>
          {next ? (
            <Button
              type="button"
              onClick={goNext}
              disabled={!canNext}
              size="2"
            >
              Next
            </Button>
          ) : (
            <Button
              type="button"
              onClick={handleStart}
              disabled={starting}
              size="2"
              className="font-semibold"
            >
              {starting ? 'Saving…' : method === 'colab' ? 'Save' : 'Start train'}
            </Button>
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

      <ConfirmDialog
        open={confirmCancel}
        title="Discard this train?"
        message="You have progress in the wizard. Leaving now discards your selections."
        confirmLabel="Discard"
        onConfirm={() => {
          setConfirmCancel(false)
          onCancel()
        }}
        onCancel={() => setConfirmCancel(false)}
      />
    </div>
  )
}