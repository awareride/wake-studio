/**
 * Datasets console — layout (ADR-044 §8, issue #208).
 *
 * Mirrors the Training console: a top-level `Datasets` view with a header
 * (+ New generation task), a left rail (the consolidated dataset list:
 * built-ins + the backend `datasets/` store + browser-local datasets, plus a
 * generation-jobs section below it), and a right details pane (dataset
 * manifest / provenance / storage / quality report + actions, or a
 * generation job's NDJSON progress). The generation wizard is a full panel
 * that replaces the list-detail layout.
 *
 * Actions (ADR-044 §8): New generation task, Train with this, Upload to
 * cloud (direct browser push — HF wired, R2/Drive flagged #107), Download
 * and Delete — each routed to the dataset's origin (local IndexedDB vs the
 * backend store; built-ins are immutable references).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@radix-ui/themes'
import { ConsolePanel } from '../../components/ConsolePanel'
import { IconWand } from '../../components/icons'
import { useAppSettings } from '../../settings'
import { useToast } from '../../components/toast'
import { rememberSelection, rememberedSelection } from '../../view-selection'
import { useDatasetsStore, type ConsoleDataset } from '../store'
import { useDatasetJobs, type SubmitGenerateInput } from '../useDatasetJobs'
import type { StudioJob } from '../../training/studio-client'
import { deleteLocalDataset, getLocalDataset, getLocalDatasetZip, saveLocalDataset } from '../local-store'
import { uploadDatasetToCloud, type CloudTarget } from '../cloud-upload'
import { downloadBlob, fetchBytes } from '../download'
import { setPendingTrainDataset } from '../train-link'
import { DatasetList } from './DatasetList'
import { DatasetDetails } from './DatasetDetails'
import { DatasetActions } from './DatasetActions'
import { DatasetJobList } from './DatasetJobList'
import { DatasetJobDetails } from './DatasetJobDetails'
import { NewDatasetWizard } from './NewDatasetWizard'

type View =
  | { kind: 'empty' }
  | { kind: 'details'; id: string }
  | { kind: 'job'; jobId: string }
  | { kind: 'wizard' }

export function DatasetsConsole() {
  const { backends, platform } = useAppSettings()
  const { toast } = useToast()
  // The consolidated store + jobs are fed by the first configured managed
  // backend (same convention as the Training console's datasets[] picker).
  const backend = backends[0]
  const store = useDatasetsStore(backend?.baseUrl, backend?.token)
  const { jobs, submitGenerate, applyLive, remove } = useDatasetJobs(store.client)
  const [view, setView] = useState<View>(() => {
    const last = rememberedSelection('datasets')
    return last ? { kind: 'details', id: last } : { kind: 'empty' }
  })

  // Restore the last-selected dataset once the store has loaded.
  useEffect(() => {
    if (store.loading || view.kind !== 'empty') return
    const last = rememberedSelection('datasets')
    if (last && store.datasets.some((d) => d.id === last)) {
      setView({ kind: 'details', id: last })
    }
  }, [store.loading, store.datasets, view.kind])

  const selected = useMemo<ConsoleDataset | null>(() => {
    if (view.kind !== 'details') return null
    return store.datasets.find((d) => d.id === view.id) ?? null
  }, [view, store.datasets])

  const selectedJob = useMemo(() => {
    if (view.kind !== 'job') return null
    return jobs.find((j) => j.id === view.jobId) ?? null
  }, [view, jobs])

  const open = useCallback((id: string) => {
    rememberSelection('datasets', id)
    setView({ kind: 'details', id })
  }, [])

  // -------------------------------------------------------------------------
  // Generation (wizard)
  // -------------------------------------------------------------------------

  /** New generation task: run the job on the decided executor, then open its
   *  details in the rail (mirrors "Start train" in Training). Backend jobs get
   *  the connected backend's endpoint so the details pane live-tracks them. */
  const handleGenerate = useCallback(
    async (input: SubmitGenerateInput) => {
      const withEndpoint: SubmitGenerateInput =
        input.executor === 'backend' && backend
          ? { ...input, endpoint: backend.baseUrl }
          : input
      const job = await submitGenerate(withEndpoint)
      rememberSelection('datasets', null)
      setView({ kind: 'job', jobId: job.id })
      // Browser executor already saved the dataset; a backend generate job
      // persists it to the store as it runs — refresh to pick it up.
      void store.refresh()
    },
    [submitGenerate, store, backend],
  )

  /** Merge live backend state into a job; when a generate job succeeds, pull
   *  the store so the newly persisted dataset appears in the rail. */
  const handleJobLiveUpdate = useCallback(
    (id: string, live: StudioJob) => {
      const prev = jobs.find((j) => j.id === id)
      applyLive(id, live)
      if (prev && prev.status !== 'succeeded' && live.status === 'succeeded') {
        void store.refresh()
      }
    },
    [jobs, applyLive, store],
  )

  const handleDeleteJob = useCallback(
    (id: string) => {
      remove(id)
      setView((v) => (v.kind === 'job' && v.jobId === id ? { kind: 'empty' } : v))
      if (view.kind === 'job' && view.jobId === id) rememberSelection('datasets', null)
    },
    [remove, view],
  )

  // -------------------------------------------------------------------------
  // Dataset actions
  // -------------------------------------------------------------------------

  /** Fetch a dataset's canonical zip bytes regardless of origin. */
  const datasetZipBytes = useCallback(
    async (dataset: ConsoleDataset): Promise<Uint8Array> => {
      if (dataset.origin === 'local') {
        const bytes = await getLocalDatasetZip(dataset.id)
        if (!bytes) throw new Error('This local dataset is missing its stored zip.')
        return bytes
      }
      if (dataset.origin === 'backend' && store.client) {
        return fetchBytes(store.client.datasetDownloadUrl(dataset.id))
      }
      throw new Error('This dataset has no downloadable zip in this browser.')
    },
    [store.client],
  )

  const handleDownload = useCallback(
    async (dataset: ConsoleDataset) => {
      try {
        const bytes = await datasetZipBytes(dataset)
        downloadBlob(bytes, `${dataset.id}-wake-studio-dataset.zip`)
        toast({ title: 'Dataset downloaded', description: `${dataset.name} (${bytes.byteLength} bytes).` })
      } catch (err) {
        toast({
          title: 'Download failed',
          description: err instanceof Error ? err.message : String(err),
          variant: 'error',
        })
      }
    },
    [datasetZipBytes, toast],
  )

  const handleDelete = useCallback(
    async (dataset: ConsoleDataset) => {
      try {
        if (dataset.origin === 'local') {
          await deleteLocalDataset(dataset.id)
        } else if (dataset.origin === 'backend' && store.client) {
          await store.client.deleteDataset(dataset.id)
        } else {
          return
        }
        await store.refresh()
        setView((v) => (v.kind === 'details' && v.id === dataset.id ? { kind: 'empty' } : v))
        if (view.kind === 'details' && view.id === dataset.id) rememberSelection('datasets', null)
        toast({ title: 'Dataset deleted', description: dataset.name })
      } catch (err) {
        toast({
          title: 'Delete failed',
          description: err instanceof Error ? err.message : String(err),
          variant: 'error',
        })
      }
    },
    [store, view, toast],
  )

  const handleUpload = useCallback(
    async (dataset: ConsoleDataset, input: { target: CloudTarget; repoId: string }) => {
      try {
        const bytes = await datasetZipBytes(dataset)
        const ref = await uploadDatasetToCloud({
          dataset,
          zipBytes: bytes,
          target: input.target,
          hfRepoId: input.repoId,
          hfToken: platform['cloud.hf.token'],
        })
        // Persist the cloud ref into a LOCAL dataset's manifest (the backend
        // store has no update route; the cloud copy exists regardless).
        if (dataset.origin === 'local') {
          const record = await getLocalDataset(dataset.id)
          if (record) {
            await saveLocalDataset(
              {
                ...record.manifest,
                storage: { ...(record.manifest.storage ?? { backend: '' }), cloud: ref },
              },
              record.zipBytes,
            )
            await store.refresh()
          }
        }
        toast({ title: 'Uploaded to cloud', description: ref, variant: 'success' })
      } catch (err) {
        toast({
          title: 'Upload failed',
          description: err instanceof Error ? err.message : String(err),
          variant: 'error',
        })
      }
    },
    [datasetZipBytes, platform, store, toast],
  )

  /** Train with this: pre-seed the dataset + deep-link into the Training
   *  wizard (the wizard consumes the pending id on mount). */
  const handleTrain = useCallback((id: string) => {
    setPendingTrainDataset(id)
    window.location.hash = '#/training/new'
  }, [])

  return (
    <>
      {view.kind === 'wizard' ? (
        /* The generation wizard as a FULL panel — no rail to interrupt the
           steps (mirrors the New-train wizard, #105). */
        <NewDatasetWizard
          backendConnected={!!backend}
          onGenerate={handleGenerate}
          onCancel={() => setView({ kind: 'empty' })}
        />
      ) : (
        <ConsolePanel
          title="Datasets"
          description="First-class training-data artifacts: pick built-ins, generate synthetic audio with a TTS engine, and persist to the backend store and/or your cloud. Every dataset is one canonical wake-studio-dataset.zip (ADR-044)."
          actions={
            <Button
              type="button"
              onClick={() => setView({ kind: 'wizard' })}
              size="2"
              className="shrink-0 gap-1.5 font-semibold"
            >
              <IconWand className="h-4 w-4" />
              New
            </Button>
          }
          railTitle="Datasets"
          railCount={store.datasets.length}
          rail={(close) => (
            <div className="min-h-0">
              <DatasetList
                datasets={store.datasets}
                selectedId={view.kind === 'details' ? selected?.id ?? null : null}
                loading={store.loading}
                onSelect={(id) => {
                  open(id)
                  close()
                }}
              />
              {jobs.length > 0 && (
                <>
                  <div className="px-4 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-widest text-ink-3">
                    Generation jobs
                  </div>
                  <DatasetJobList
                    jobs={jobs}
                    selectedId={view.kind === 'job' ? selectedJob?.id ?? null : null}
                    onSelect={(jobId) => {
                      rememberSelection('datasets', null)
                      setView({ kind: 'job', jobId })
                      close()
                    }}
                  />
                </>
              )}
            </div>
          )}
          details={
            view.kind === 'details' && selected ? (
              <>
                <DatasetDetails key={selected.id} dataset={selected} />
                <DatasetActions
                  dataset={selected}
                  client={store.client}
                  onNew={() => setView({ kind: 'wizard' })}
                  onTrain={handleTrain}
                  onUpload={handleUpload}
                  onDownload={handleDownload}
                  onDelete={handleDelete}
                />
                {store.backendError && (
                  <div className="rounded-xl border border-danger/40 bg-danger/5 p-4 text-xs text-danger">
                    Could not load the backend dataset store: {store.backendError}
                  </div>
                )}
                {store.builtinError && (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-xs text-amber-700">
                    Built-in catalog unavailable: {store.builtinError}
                  </div>
                )}
              </>
            ) : view.kind === 'job' && selectedJob ? (
              <DatasetJobDetails
                key={selectedJob.id}
                job={selectedJob}
                onLiveUpdate={handleJobLiveUpdate}
                onDelete={handleDeleteJob}
              />
            ) : null
          }
          detailsEmpty={
            view.kind === 'details' ? (
              <div className="rounded-xl border border-line bg-surface-2 p-6 text-sm text-ink-2">
                This dataset is no longer in the list (deleted?). Pick another from the rail.
              </div>
            ) : view.kind === 'job' ? (
              <div className="rounded-xl border border-line bg-surface-2 p-6 text-sm text-ink-2">
                This job is no longer in the list (deleted?). Pick another from the rail.
              </div>
            ) : (
              <div className="rounded-xl border border-line bg-surface-2 p-8 text-center">
                <p className="text-sm font-medium text-ink-1">No dataset selected</p>
                <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-ink-3">
                  Pick a dataset in the left rail to inspect its manifest, provenance, storage
                  and quality report, or press{' '}
                  <span className="font-medium text-ink-2">New</span> (the wizard wand) to
                  generate one.
                </p>
              </div>
            )
          }
        />
      )}
    </>
  )
}

export default DatasetsConsole
