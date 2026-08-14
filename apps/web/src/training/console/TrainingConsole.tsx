/**
 * Training console — layout (issue #105).
 *
 *   Header: Training · [New]  (wizard wand)
 *   Left rail:  train list (persistent, IndexedDB; each item notes its
 *               latest notification)
 *   Right pane: the selected train's details (status / notifications /
 *               results / inputs review), or an empty state.
 *
 * The layout itself (header + rail + details + mobile drawer) is the shared
 * ConsolePanel; the New-train wizard is a FULL panel that replaces it (no
 * dialog, no left rail while it is open, so the steps cannot be interrupted).
 * Confirming a train records the job and opens its review immediately;
 * Colab imports record/update the job and open its review too.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@radix-ui/themes'
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
import { ConsolePanel } from '../../components/ConsolePanel'
import { IconWand } from '../../components/icons'
import { useAppSettings } from '../../settings'
import { TRAIN_NEW_HASH_PREFIX } from '../../router'
import { NewTrainWizard } from './NewTrainWizard'
import { TrainDetails } from './TrainDetails'
import { TrainList } from './TrainList'
import { ConfirmDialog } from './ConfirmDialog'
import { fetchTrainableModules, type TrainableModule } from '../train-modules'
import { createStudioClient, type StudioJobPatch } from '../studio-client'
import type { ColabImportResult } from '../colab-import'

type View =
  | { kind: 'empty' }
  | { kind: 'details'; jobId: string }
  | { kind: 'wizard'; from: { kind: 'empty' } | { kind: 'details'; jobId: string } }

export function TrainingConsole() {
  const { platform, backends } = useAppSettings()
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
      // Walking wizard steps (`#/training/new[/<step>]`, issue #136) is always
      // allowed; the guard fires only when the hash leaves the wizard route.
      const leavingWizard =
        viewRef.current.kind === 'wizard' &&
        !target.startsWith(`#${TRAIN_NEW_HASH_PREFIX}`)
      if (!leavingWizard || !wizardDirtyRef.current) {
        lastHashRef.current = target
        // Leaving without unsaved progress (e.g. browser back to the Trains
        // list): close the wizard and return to the pre-wizard view.
        if (leavingWizard) setView((v) => (v.kind === 'wizard' ? v.from : v))
        return
      }
      // Revert and ask.
      location.hash = lastHashRef.current
      setConfirmNav({ target })
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // A refresh while the wizard was open leaves a `#/training/new/...` hash but
  // no wizard state — drop the stale entry so back/forward behave (issue #136).
  useEffect(() => {
    if (location.hash.startsWith(`#${TRAIN_NEW_HASH_PREFIX}`)) {
      location.replace('#/training')
    }
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

  /** Patch one field of a recorded job (e.g. the Colab tunnel URL).
   *  `persist` forces an IndexedDB write; otherwise only status/terminal
   *  changes persist (live progress/metrics churn must not spam the store). */
  const patchJob = useCallback(
    (jobId: string, patch: Partial<HistoryJob>, persist = false) => {
      setJobs((prev) => {
        const target = prev.find((j) => j.id === jobId)
        if (!target) return prev
        const next = { ...target, ...patch }
        const meaningful =
          patch.status !== undefined ||
          patch.finishedAtMs !== undefined ||
          patch.endpoint !== undefined ||
          patch.tunnelUrl !== undefined ||
          patch.submitted !== undefined ||
          patch.error !== undefined
        if (persist || meaningful) void saveJob(next)
        return upsertJob(prev, next)
      })
    },
    [],
  )

  const selectedJob = useMemo(() => {
    if (view.kind !== 'details') return null
    return jobs.find((j) => j.id === view.jobId) ?? null
  }, [view, jobs])

  // Wizard "Save/Start": record the job, open its review (issue #105).
  // For the Studio-backend method the job is submitted to the chosen managed
  // backend (Backends menu) — POST /jobs — and tracked live (issue #122).
  const handleWizardStarted = useCallback(
    (
      moduleId: string,
      method: TrainMethodId,
      params: Record<string, string>,
      backendId?: string,
    ) => {
      const id = `train-${Date.now()}`
      const job = startedJob({
        id,
        moduleId,
        method,
        backend: backendForMethod(method),
        params,
      })
      if (method === 'studio-backend') {
        const backend = backends.find((b) => b.id === backendId)
        if (!backend) {
          recordJob({
            ...job,
            status: 'failed',
            error: 'The chosen backend no longer exists — add it again in the Backends menu.',
            finishedAtMs: Date.now(),
          })
          setView({ kind: 'details', jobId: job.id })
          return
        }
        const endpoint = backend.baseUrl
        const token = backend.token || undefined
        recordJob({ ...job, endpoint, backendId: backend.id })
        setView({ kind: 'details', jobId: job.id })
        const client = createStudioClient(endpoint, token)
        void client
          .createJob(moduleId, params, id)
          .then(() => patchJob(id, { submitted: true }))
          .catch((err: unknown) =>
            patchJob(id, {
              status: 'failed',
              error: err instanceof Error ? err.message : String(err),
              finishedAtMs: Date.now(),
            }),
          )
      } else {
        recordJob(job)
        setView({ kind: 'details', jobId: job.id })
      }
      // The wizard's step entries stay in history — replace the current one
      // with the Trains list so back from the details pane does not re-enter
      // the finished wizard (issue #136).
      location.replace('#/training')
    },
    [backends, recordJob, patchJob],
  )

  // Colab "Connect": once the notebook's tunnel URL is pasted, submit the job
  // to the tunnel (same /jobs contract — ADR-023 amendment) and track it live.
  const handleConnectColab = useCallback(
    (job: HistoryJob) => {
      if (!job.tunnelUrl) return
      const token = platform['backend.apiKey'] || platform['backend.secret'] || undefined
      const client = createStudioClient(job.tunnelUrl, token)
      patchJob(job.id, { endpoint: job.tunnelUrl })
      void client
        .createJob(job.moduleId, job.params, job.id)
        .then(() => patchJob(job.id, { submitted: true }))
        .catch((err: unknown) =>
          patchJob(job.id, {
            error: err instanceof Error ? err.message : String(err),
          }),
        )
    },
    [platform, patchJob],
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
    <>
      {view.kind === 'wizard' ? (
        /* The New-train wizard as a FULL panel — no dialog, no left rail to
           interrupt the steps (issue #105). */
        <NewTrainWizard
          modules={modules}
          onStarted={handleWizardStarted}
          onCancel={() => {
            setView(view.from)
            // Replace the current step entry (not push) so the Trains list is
            // the new top of history (issue #136).
            location.replace('#/training')
          }}
          onDirtyChange={handleDirtyChange}
        />
      ) : (
        <ConsolePanel
          title="Training"
          description="Train a custom model end to end: pick a trainable module, configure it, choose a train method (Colab / Studio-backend / CI), then review the run. Training never runs in the browser (ADR-013)."
          actions={
            <Button
              type="button"
              onClick={() => {
                setView({ kind: 'wizard', from: view })
                // Opening the wizard is a history entry itself: browser back
                // from step 1 returns to the Trains list (issue #136).
                location.hash = `#${TRAIN_NEW_HASH_PREFIX}`
              }}
              size="2"
              className="shrink-0 gap-1.5 font-semibold"
            >
              <IconWand className="h-4 w-4" />
              New
            </Button>
          }
          railTitle="Trains"
          railCount={jobs.length}
          rail={(close) => (
            <TrainList
              jobs={jobs}
              selectedId={selectedJob?.id ?? null}
              onSelect={(id) => {
                openTrain(id)
                close()
              }}
            />
          )}
          details={
            view.kind === 'details' && selectedJob ? (
              <>
                <TrainDetails
                  key={selectedJob.id}
                  job={selectedJob}
                  modules={modules}
                  onImported={handleImported}
                  onTunnelUrlChange={(url) => patchJob(selectedJob.id, { tunnelUrl: url }, true)}
                  onConnectColab={() => handleConnectColab(selectedJob)}
                  onLiveUpdate={(patch: StudioJobPatch) => patchJob(selectedJob.id, patch)}
                  onDelete={() => handleDeleteJob(selectedJob.id)}
                />
                {modulesError && (
                  <div className="rounded-xl border border-danger/40 bg-danger/5 p-4 text-xs text-danger">
                    Could not load the trainable-modules catalog: {modulesError}
                  </div>
                )}
              </>
            ) : modulesError ? (
              <div className="rounded-xl border border-danger/40 bg-danger/5 p-4 text-xs text-danger">
                Could not load the trainable-modules catalog: {modulesError}
              </div>
            ) : null
          }
          detailsEmpty={
            view.kind === 'details' ? (
              <div className="rounded-xl border border-line bg-surface-2 p-6 text-sm text-ink-2">
                This train is no longer in the list (deleted?). Pick another from the rail.
              </div>
            ) : (
              <div className="rounded-xl border border-line bg-surface-2 p-8 text-center">
                <p className="text-sm font-medium text-ink-1">No train selected</p>
                <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-ink-3">
                  Press <span className="font-medium text-ink-2">New</span> (the wizard wand) to
                  pick a trainable module (KWS openwakeword, KWS streaming, RNNoise…), configure
                  it, choose a train method, and confirm. Past trains stay in the left rail.
                </p>
              </div>
            )
          }
        />
      )}

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
            // Leave the wizard too — the hash may be the Trains list itself
            // (browser back), which does not unmount the console (issue #136).
            setView((v) => (v.kind === 'wizard' ? v.from : v))
          }
          setConfirmNav(null)
        }}
        onCancel={() => setConfirmNav(null)}
      />
    </>
  )
}

export default TrainingConsole
