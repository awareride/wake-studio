/**
 * Training console — layout (issue #105).
 *
 *   Header: Training · [New train]
 *   Left rail:  Train news (tips)  ·  Train list (persistent, IndexedDB)
 *   Right pane: the New Train wizard, or the selected train's details
 *               (status / results / inputs review), or an empty state.
 *
 * The wizard records a job on Start and opens its review immediately.
 * Colab imports record/update the job and open its review too.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  backendForMethod,
  deriveNews,
  importedJob,
  sortJobsNewestFirst,
  startedJob,
  upsertJob,
  type HistoryJob,
  type TrainMethodId,
} from '@wake-studio/module-training'
import { clearJobs, listJobs, saveJob } from '@wake-studio/module-training'
import { NewTrainWizard } from './NewTrainWizard'
import { TrainDetails } from './TrainDetails'
import { TrainList } from './TrainList'
import { TrainNews } from './TrainNews'
import { fetchTrainableModules, type TrainableModule } from '../train-modules'
import type { ColabImportResult } from '../colab-import'

type View =
  | { kind: 'empty' }
  | { kind: 'wizard'; from: string | null }
  | { kind: 'details'; jobId: string }

const TUNNEL_URL_KEY = 'wake-studio:train:tunnelUrl'
const ENDPOINT_URL_KEY = 'wake-studio:train:endpointUrl'

function loadUrl(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? ''
  } catch {
    return ''
  }
}

export function TrainingConsole() {
  const [jobs, setJobs] = useState<HistoryJob[]>([])
  const [modules, setModules] = useState<TrainableModule[]>([])
  const [modulesError, setModulesError] = useState<string | null>(null)
  const [view, setView] = useState<View>({ kind: 'empty' })
  const [tunnelUrl, setTunnelUrl] = useState(() => loadUrl(TUNNEL_URL_KEY))
  const [endpointUrl, setEndpointUrl] = useState(() => loadUrl(ENDPOINT_URL_KEY))
  const [confirmingClear, setConfirmingClear] = useState(false)

  // Load the persistent train list + the trainable-modules catalog once.
  useEffect(() => {
    let alive = true
    void listJobs().then((all) => {
      if (alive) setJobs(sortJobsNewestFirst(all))
    })
    fetchTrainableModules()
      .then((mods) => alive && setModules(mods))
      .catch((err: unknown) => alive && setModulesError(err instanceof Error ? err.message : String(err)))
    return () => {
      alive = false
    }
  }, [])

  const persistUrl = useCallback((key: string) => (value: string) => {
    try {
      window.localStorage.setItem(key, value)
    } catch {
      /* private mode — fine, session-only */
    }
  }, [])

  const recordJob = useCallback((job: HistoryJob) => {
    setJobs((prev) => upsertJob(prev, job))
    void saveJob(job)
  }, [])

  const selectedJob = useMemo(() => {
    if (view.kind !== 'details') return null
    return jobs.find((j) => j.id === view.jobId) ?? null
  }, [view, jobs])

  const news = useMemo(() => deriveNews(jobs), [jobs])

  // Wizard "Start": record the job, open its review (issue #105).
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

  const handleClear = useCallback(() => {
    if (!confirmingClear) {
      setConfirmingClear(true)
      setTimeout(() => setConfirmingClear(false), 2500)
      return
    }
    setConfirmingClear(false)
    void clearJobs().then(() => {
      setJobs([])
      setView({ kind: 'empty' })
    })
  }, [confirmingClear])

  const openTrain = useCallback((jobId: string) => setView({ kind: 'details', jobId }), [])

  return (
    <div className="space-y-6">
      {/* Header. */}
      <div className="flex items-start justify-between gap-4">
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
          onClick={() => setView((v) => ({ kind: 'wizard', from: v.kind === 'details' ? v.jobId : null }))}
          className="shrink-0 rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-ink-1 transition-colors hover:bg-brand-400"
        >
          + New train
        </button>
      </div>

      <div className="flex gap-6">
        {/* Left rail: news + list. */}
        <aside className="flex w-72 shrink-0 flex-col border-r border-line">
          <TrainNews items={news} onOpen={openTrain} />
          <TrainList
            jobs={jobs}
            selectedId={selectedJob?.id ?? null}
            onSelect={openTrain}
            onClear={handleClear}
            confirmingClear={confirmingClear}
          />
        </aside>

        {/* Right pane. */}
        <div className="min-w-0 flex-1">
          {view.kind === 'wizard' && (
            <NewTrainWizard
              modules={modules}
              tunnelUrl={tunnelUrl}
              onChangeTunnelUrl={(u) => {
                setTunnelUrl(u)
                persistUrl(TUNNEL_URL_KEY)(u)
              }}
              endpointUrl={endpointUrl}
              onChangeEndpointUrl={(u) => {
                setEndpointUrl(u)
                persistUrl(ENDPOINT_URL_KEY)(u)
              }}
              onStarted={handleWizardStarted}
              onCancel={() => setView(view.from ? { kind: 'details', jobId: view.from } : { kind: 'empty' })}
            />
          )}

          {view.kind === 'details' &&
            (selectedJob ? (
              <TrainDetails job={selectedJob} modules={modules} onImported={handleImported} />
            ) : (
              <div className="rounded-xl border border-line bg-surface-2 p-6 text-sm text-ink-2">
                This train is no longer in the list (cleared?). Pick another from the rail.
              </div>
            ))}

          {view.kind === 'empty' && (
            <div className="rounded-xl border border-line bg-surface-2 p-8 text-center">
              <p className="text-sm font-medium text-ink-1">No train selected</p>
              <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-ink-3">
                Press <span className="font-medium text-ink-2">+ New train</span> to pick a
                trainable module (KWS openwakeword, KWS streaming, RNNoise…), configure it,
                choose a train method, and start. Past trains stay in the left rail.
              </p>
            </div>
          )}

          {modulesError && view.kind !== 'details' && (
            <div className="mt-4 rounded-xl border border-danger/40 bg-danger/5 p-4 text-xs text-danger">
              Could not load the trainable-modules catalog: {modulesError}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default TrainingConsole