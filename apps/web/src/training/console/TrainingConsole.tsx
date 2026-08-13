/**
 * Training console — layout (issue #105).
 *
 *   Header: Training · [New]  (wizard wand)
 *   Left rail:  train list (persistent, IndexedDB; each item notes its
 *               latest notification)
 *   Right pane: the selected train's details (status / notifications /
 *               results / inputs review), or an empty state.
 *
 * The New-train wizard is a FULL panel of the Training view (no dialog, no
 * left rail while it is open, so the steps cannot be interrupted).
 * Confirming a train records the job and opens its review immediately;
 * Colab imports record/update the job and open its review too.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  backendForMethod,
  importedJob,
  sortJobsNewestFirst,
  startedJob,
  upsertJob,
  type HistoryJob,
  type TrainMethodId,
} from '@wake-studio/module-training'
import { deleteJob, listJobs, saveJob } from '@wake-studio/module-training'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui'
import { IconMenu, IconWand } from '../../components/icons'
import { NewTrainWizard } from './NewTrainWizard'
import { TrainDetails } from './TrainDetails'
import { TrainList } from './TrainList'
import { ConfirmDialog } from './ConfirmDialog'
import { useIsDesktop } from './useIsDesktop'
import { fetchTrainableModules, type TrainableModule } from '../train-modules'
import type { ColabImportResult } from '../colab-import'

type View =
  | { kind: 'empty' }
  | { kind: 'details'; jobId: string }
  | { kind: 'wizard'; from: { kind: 'empty' } | { kind: 'details'; jobId: string } }

export function TrainingConsole() {
  const [jobs, setJobs] = useState<HistoryJob[]>([])
  const [modules, setModules] = useState<TrainableModule[]>([])
  const [modulesError, setModulesError] = useState<string | null>(null)
  const [view, setView] = useState<View>({ kind: 'empty' })

  // Unsaved-progress guard: leaving the wizard via another menu asks first.
  const wizardDirtyRef = useRef(false)
  const viewRef = useRef(view)
  viewRef.current = view
  const navGuardRef = useRef(false)
  const lastHashRef = useRef(location.hash)
  const [confirmNav, setConfirmNav] = useState<{ target: string } | null>(null)

  useEffect(() => {
    const onHash = () => {
      const target = location.hash
      if (navGuardRef.current) {
        navGuardRef.current = false
        lastHashRef.current = target
        return
      }
      if (viewRef.current.kind !== 'wizard' || !wizardDirtyRef.current) {
        lastHashRef.current = target
        return
      }
      // Revert and ask.
      location.hash = lastHashRef.current
      setConfirmNav({ target })
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const handleDirtyChange = useCallback((dirty: boolean) => {
    wizardDirtyRef.current = dirty
  }, [])

  // Load the persistent train list + the trainable-modules catalog once.
  useEffect(() => {
    let alive = true
    void listJobs().then((all) => {
      if (alive) setJobs(sortJobsNewestFirst(all))
    })
    fetchTrainableModules()
      .then((mods) => alive && setModules(mods))
      .catch((err: unknown) =>
        alive && setModulesError(err instanceof Error ? err.message : String(err)),
      )
    return () => {
      alive = false
    }
  }, [])

  const recordJob = useCallback((job: HistoryJob) => {
    setJobs((prev) => upsertJob(prev, job))
    void saveJob(job)
  }, [])

  /** Patch one field of a recorded job (e.g. the Colab tunnel URL). */
  const patchJob = useCallback(
    (jobId: string, patch: Partial<HistoryJob>) => {
      setJobs((prev) => {
        const target = prev.find((j) => j.id === jobId)
        if (!target) return prev
        const next = upsertJob(prev, { ...target, ...patch })
        void saveJob({ ...target, ...patch })
        return next
      })
    },
    [],
  )

  const selectedJob = useMemo(() => {
    if (view.kind !== 'details') return null
    return jobs.find((j) => j.id === view.jobId) ?? null
  }, [view, jobs])

  // Wizard "Save/Start": record the job, open its review (issue #105).
  const handleWizardStarted = useCallback(
    (moduleId: string, method: TrainMethodId, params: Record<string, string>) => {
      const job = startedJob({
        id: `train-${Date.now()}`,
        moduleId,
        method,
        backend: backendForMethod(method),
        params,
      })
      recordJob(job)
      setView({ kind: 'details', jobId: job.id })
    },
    [recordJob],
  )

  // Colab import success: record/update the job, open its review.
  const handleImported = useCallback(
    (result: ColabImportResult) => {
      const job = importedJob({
        jobId: result.bundle.jobId,
        metadata: result.bundle.files.metadata,
        provenance: result.bundle.files.provenance,
        metrics: result.bundle.files.metrics,
        classifierRef: result.classifierRef,
      })
      recordJob(job)
      setView({ kind: 'details', jobId: job.id })
    },
    [recordJob],
  )

  const openTrain = useCallback((jobId: string) => setView({ kind: 'details', jobId }), [])

  // Rail visibility: desktop collapses the inline rail horizontally; on
  // mobile the train list is a left-edge drawer (shell-sidebar pattern).
  const isDesktop = useIsDesktop()
  const [railCollapsed, setRailCollapsed] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const handleRailToggle = useCallback(() => {
    if (isDesktop) setRailCollapsed((c) => !c)
    else setDrawerOpen(true)
  }, [isDesktop])

  /** Per-train delete (details → Operations → Delete, issue #105). */
  const handleDeleteJob = useCallback(
    (jobId: string) => {
      setJobs((prev) => prev.filter((j) => j.id !== jobId))
      void deleteJob(jobId)
      setView((v) => (v.kind === 'details' && v.jobId === jobId ? { kind: 'empty' } : v))
    },
    [],
  )

  return (
    <div className="flex h-[calc(100dvh-7.5rem)] min-h-[24rem] flex-col gap-6">
      {/* Header (hidden while the wizard is open — the wizard has its own
          header, and a constant chrome keeps the pinned footer stable on
          PC and mobile, issue #105). */}
      {view.kind !== 'wizard' && (
        <div className="flex shrink-0 items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-ink-1">Training</h2>
            <p className="mt-1 max-w-2xl text-sm text-ink-2">
              Train a custom model end to end: pick a trainable module, configure it,
              choose a train method (Colab / self-hosted / CI), then review the run.
              Training never runs in the browser (ADR-013).
            </p>
          </div>
          <button
            type="button"
            onClick={() => setView({ kind: 'wizard', from: view })}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-ink-1 transition-colors hover:bg-brand-400"
          >
            <IconWand className="h-4 w-4" />
            New
          </button>
        </div>
      )}

      {view.kind === 'wizard' ? (
        /* The New-train wizard as a FULL panel of the Training view — no
           dialog, no left rail to interrupt the steps (issue #105). */
        <NewTrainWizard
          modules={modules}
          onStarted={handleWizardStarted}
          onCancel={() => setView(view.from)}
          onDirtyChange={handleDirtyChange}
        />
      ) : (
        /* Split-scroll panel: the train list and the details each scroll
           independently within the panel's height (issue #105). */
        <div className="flex min-h-0 flex-1 gap-6">
          {/* Left rail (desktop): the train list — hidden when collapsed.
              On mobile the rail is a drawer (below). */}
          {!railCollapsed && (
            <aside className="hidden min-h-0 w-72 shrink-0 flex-col border-r border-line lg:flex">
              <TrainList
                jobs={jobs}
                selectedId={selectedJob?.id ?? null}
                onSelect={openTrain}
                onToggle={handleRailToggle}
              />
            </aside>
          )}

          {/* Right pane: details or empty state — its own scroll. */}
          <div className="flex min-w-0 flex-1 flex-col">
            {/* Re-open the train list when it is not visible: the primary
                toggle lives in the TRAINS header (issue #105). */}
            {(!isDesktop || railCollapsed) && (
              <div className="mb-2 flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={handleRailToggle}
                  aria-label={isDesktop ? 'Show train list' : 'Open train list'}
                  className="rounded-md p-1 text-ink-3 transition-colors hover:bg-surface-3 hover:text-ink-1"
                >
                  <IconMenu className="h-4 w-4" />
                </button>
                <span className="text-[11px] text-ink-3">Train list</span>
              </div>
            )}
            {/* The details content scrolls independently of the train list. */}
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
              {view.kind === 'details' &&
                (selectedJob ? (
                  <TrainDetails
                    key={selectedJob.id}
                    job={selectedJob}
                    modules={modules}
                    onImported={handleImported}
                    onTunnelUrlChange={(url) => patchJob(selectedJob.id, { tunnelUrl: url })}
                    onDelete={() => handleDeleteJob(selectedJob.id)}
                  />
                ) : (
                  <div className="rounded-xl border border-line bg-surface-2 p-6 text-sm text-ink-2">
                    This train is no longer in the list (deleted?). Pick another from the rail.
                  </div>
                ))}

              {view.kind === 'empty' && (
                <div className="rounded-xl border border-line bg-surface-2 p-8 text-center">
                  <p className="text-sm font-medium text-ink-1">No train selected</p>
                  <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-ink-3">
                    Press <span className="font-medium text-ink-2">New</span> (the wizard wand) to
                    pick a trainable module (KWS openwakeword, KWS streaming, RNNoise…), configure
                    it, choose a train method, and confirm. Past trains stay in the left rail.
                  </p>
                </div>
              )}

              {modulesError && (
                <div className="mt-4 rounded-xl border border-danger/40 bg-danger/5 p-4 text-xs text-danger">
                  Could not load the trainable-modules catalog: {modulesError}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {/* Mobile train-list drawer — matches the shell's mobile sidebar
          exactly (drawer-content, slide-in animation, default overlay). */}
      <Dialog open={drawerOpen} onOpenChange={setDrawerOpen}>
        <DialogContent
          centered={false}
          className="drawer-content left-0 top-0 h-screen w-[min(80vw,18rem)] max-w-[calc(100vw-2rem)] rounded-r-xl border-l border-t-0 border-r-0 border-b-0 p-0 data-[state=open]:animate-[drawer-in_180ms_ease-out] data-[state=closed]:animate-[drawer-out_160ms_ease-in]"
        >
          <DialogTitle className="sr-only">Train list</DialogTitle>
          <DialogDescription className="sr-only">
            Your saved training jobs
          </DialogDescription>
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-ink-3">
              Train list
            </span>
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              aria-label="Close train list"
              className="rounded-md p-1.5 text-ink-3 transition-colors hover:bg-surface-3 hover:text-ink-1"
            >
              ✕
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            <TrainList
              jobs={jobs}
              selectedId={selectedJob?.id ?? null}
              onSelect={(id) => {
                openTrain(id)
                setDrawerOpen(false)
              }}
              onToggle={() => setDrawerOpen(false)}
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* Leaving mid-wizard via another menu (issue #105). */}
      <ConfirmDialog
        open={confirmNav !== null}
        title="Leave without saving this train?"
        message="You have progress in the New-train wizard. Leaving now discards it."
        confirmLabel="Leave anyway"
        onConfirm={() => {
          if (confirmNav) {
            navGuardRef.current = true
            location.hash = confirmNav.target
          }
          setConfirmNav(null)
        }}
        onCancel={() => setConfirmNav(null)}
      />
    </div>
  )
}

export default TrainingConsole