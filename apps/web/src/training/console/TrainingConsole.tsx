/**
 * Training console — stepper + history rail + guide (issue #105).
 *
 * App-layer container around the training module's spec-driven panel
 * (ADR-025 — never hand-written controls). Layout:
 *
 *   Configure → Connect backend → Run/monitor → Review   (stepper)
 *   Train history                                        (left rail)
 *   Inline tooltips + collapsible help drawer            (guide, not a tab)
 *
 * The generated panel stays mounted across all steps (hidden on the app-only
 * steps) so param/status state survives navigation; only the rendered
 * sections change per step. Jobs are recorded in IndexedDB history
 * (history-store.ts) on "Start training" and on Colab import success.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  STEP_DEFS,
  advanceStep,
  importedJob,
  jobPhase,
  listJobs,
  saveJob,
  sortJobsNewestFirst,
  startedJob,
  upsertJob,
  type HistoryJob,
  type TrainingJob,
  type TrainingStepId,
} from '@wake-studio/module-training'
import { TrainingModulePanel } from '@wake-studio/module-training/web'
import { StepperNav } from './StepperNav'
import { HistoryRail } from './HistoryRail'
import { HelpDrawer } from './HelpDrawer'
import { ConnectStep } from './ConnectStep'
import { ReviewStep } from './ReviewStep'
import { sectionsForStep } from './steps'
import { ImportColabResults } from '../ImportColabResults'
import type { ColabImportResult } from '../colab-import'
import { cn } from '../../components/cn'

export function TrainingConsole() {
  const [step, setStep] = useState<TrainingStepId>('configure')
  const [jobs, setJobs] = useState<HistoryJob[]>([])
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const [tunnelUrl, setTunnelUrl] = useState('')
  const [helpOpen, setHelpOpen] = useState(false)
  const [helpFocus, setHelpFocus] = useState<TrainingStepId>('configure')
  const [lastImport, setLastImport] = useState<ColabImportResult | null>(null)

  // Load the persistent history rail once on mount (IndexedDB).
  useEffect(() => {
    let alive = true
    void listJobs().then((all) => {
      if (alive) setJobs(sortJobsNewestFirst(all))
    })
    return () => {
      alive = false
    }
  }, [])

  const activeJob = jobs[0] ?? null
  const phase = useMemo(() => (activeJob ? jobPhase(activeJob.status) : 'idle'), [activeJob])

  // Auto-advance to Review on job success (plan T-7): a succeeded latest
  // job while on the Run step moves the stepper forward.
  useEffect(() => {
    if (phase === 'succeeded') {
      setStep((s) => (s === 'run' ? (advanceStep(s, phase) ?? s) : s))
    }
  }, [phase])

  const selectedJob = useMemo(
    () => jobs.find((j) => j.id === selectedJobId) ?? activeJob,
    [jobs, selectedJobId, activeJob],
  )

  const recordJob = useCallback((job: HistoryJob) => {
    setJobs((prev) => upsertJob(prev, job))
    setSelectedJobId(job.id)
    void saveJob(job)
  }, [])

  // "Start training" fired in the generated panel → record a queued job.
  const handleAction = useCallback(
    (actionId: string, values: Record<string, string>) => {
      if (actionId !== 'train') return
      const backend: TrainingJob['backend'] =
        values.backend === 'cloud' || values.backend === 'colab' || values.backend === 'self-hosted'
          ? values.backend
          : 'colab'
      recordJob(
        startedJob({
          id: `local-${Date.now()}`,
          backend,
          params: values,
        }),
      )
    },
    [recordJob],
  )

  // Colab import succeeded → record the job, auto-advance to Review.
  const handleImported = useCallback(
    (result: ColabImportResult) => {
      setLastImport(result)
      recordJob(
        importedJob({
          jobId: result.bundle.jobId,
          metadata: result.bundle.files.metadata,
          provenance: result.bundle.files.provenance,
          metrics: result.bundle.files.metrics,
          classifierRef: result.classifierRef,
        }),
      )
      setStep('review')
    },
    [recordJob],
  )

  const handleCleared = useCallback(() => {
    setJobs([])
    setSelectedJobId(null)
    setLastImport(null)
    setStep('configure')
  }, [])

  const openHelp = useCallback((focus: TrainingStepId) => {
    setHelpFocus(focus)
    setHelpOpen(true)
  }, [])

  return (
    <div className="space-y-6">
      {/* Console header: title + guide trigger. */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-ink-1">Training</h2>
          <p className="mt-1 max-w-2xl text-sm text-ink-2">
            Train a custom wake word end to end: configure, connect a backend,
            run, and review. Training never runs in the browser (ADR-013) —
            Colab (free GPU, your Google account) is the v1 backend.
          </p>
        </div>
        <button
          type="button"
          onClick={() => openHelp(step)}
          aria-label="Open training guide"
          className="rounded-full border border-line bg-surface-2 px-3 py-1.5 text-sm font-medium text-ink-2 transition-colors hover:bg-surface-3"
        >
          Guide <span className="ml-1 font-semibold">?</span>
        </button>
      </div>

      {/* Stepper over the module panel. */}
      <StepperNav step={step} phase={phase} onStepChange={setStep} onHelp={openHelp} />

      <div className="flex gap-6">
        {/* Persistent history rail (orthogonal browsing). */}
        <HistoryRail
          jobs={jobs}
          selectedId={selectedJob?.id ?? null}
          onSelect={setSelectedJobId}
          onCleared={handleCleared}
        />

        {/* Step content. */}
        <div className="min-w-0 flex-1">
          {step === 'connect' && (
            <ConnectStep tunnelUrl={tunnelUrl} onChangeTunnelUrl={setTunnelUrl} />
          )}

          {step === 'review' && (
            <ReviewStep job={selectedJob} testModelHint={lastImport?.model.name} />
          )}

          {/*
            The module panel (ADR-025 generated panel): kept mounted across
            steps so param/status state survives; scoped per step — params on
            Configure, actions + status on Run/monitor — and hidden on the
            app-only steps (Connect/Review render content above).
          */}
          <div className={cn(step === 'configure' || step === 'run' ? '' : 'hidden')}>
            <TrainingModulePanel
              sections={sectionsForStep(step)}
              onAction={handleAction}
            />
          </div>

          {/* The import half of the loop (issue #97), in the Run step. */}
          {step === 'run' && (
            <div className="mt-8">
              <ImportColabResults onImported={handleImported} />
            </div>
          )}

          {/* Inline guidance for the current step is one click away. */}
          <p className="mt-6 text-xs text-ink-3">
            Need a hand?{' '}
            <button
              type="button"
              onClick={() => openHelp(step)}
              className="font-medium text-brand-400 underline-offset-2 hover:underline"
            >
              Open the guide for “{STEP_DEFS.find((d) => d.id === step)?.label}”
            </button>
          </p>
        </div>
      </div>

      <HelpDrawer open={helpOpen} onOpenChange={setHelpOpen} focusStep={helpFocus} />
    </div>
  )
}

export default TrainingConsole