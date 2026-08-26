/**
 * Datasets — generation/storage jobs hook (ADR-044 §8, #208).
 *
 * Loads the persisted job list and runs generation jobs on EITHER executor
 * (the §8.1 decision):
 *
 *   - backend: records a queued job + `POST /jobs` (moduleId
 *     `dataset-generate` / `dataset-storage`). Live NDJSON tracking happens in
 *     the job details pane (shared StudioClient / useStudioJob, same as
 *     Training).
 *   - browser: runs the browser executor (`generateDatasetInBrowser`) with
 *     progress reported back into the job, saves the produced zip to the
 *     browser-local store, then marks the job succeeded.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { StudioClient, StudioJob } from '../training/studio-client'
import type { GenerationExecutor } from './executor'
import {
  deleteDatasetJob,
  listDatasetJobs,
  saveDatasetJob,
  startedDatasetJob,
  upsertJob,
  type DatasetJob,
  type DatasetJobKind,
} from './jobs'
import { generateDatasetInBrowser } from './browser/generate'
import { pushToHuggingFace } from './browser/hf-push'
import { saveLocalDataset } from './local-store'

function toList(value: string | undefined, fallback: string[]): string[] {
  if (!value) return fallback
  return value.split(/[,;]/).map((s) => s.trim()).filter(Boolean)
}

export interface BrowserCloudSave {
  /** Hugging Face repo id, e.g. "user/wake-words-zh-en". */
  repoId: string
  /** Settings cloud.hf.token. */
  token: string
}

export interface SubmitGenerateInput {
  kind?: DatasetJobKind
  moduleId: 'dataset-generate' | 'dataset-storage'
  executor: GenerationExecutor
  params: Record<string, string>
  endpoint?: string
  /** Optional direct browser cloud save (browser executor only, #208). */
  cloud?: BrowserCloudSave
}

export function useDatasetJobs(client: StudioClient | null) {
  const [jobs, setJobs] = useState<DatasetJob[]>([])
  const runningRef = useRef(false)

  const patch = useCallback((id: string, p: Partial<DatasetJob>) => {
    setJobs((prev) => {
      const target = prev.find((j) => j.id === id)
      if (!target) return prev
      const next = { ...target, ...p }
      void saveDatasetJob(next)
      return upsertJob(prev, next)
    })
  }, [])

  useEffect(() => {
    let cancelled = false
    void listDatasetJobs().then((all) => {
      if (!cancelled) setJobs(all)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const record = useCallback((job: DatasetJob) => {
    setJobs((prev) => upsertJob(prev, job))
    void saveDatasetJob(job)
  }, [])

  /** Submit a generation job on the chosen executor.
   *
   * Backend: records + POSTs /jobs; returns immediately (live tracking in the
   * details pane). Browser: runs the client-side pipeline and resolves when
   * the dataset is generated (saved to the local store). */
  const submitGenerate = useCallback(
    async (input: SubmitGenerateInput): Promise<DatasetJob> => {
      const id = `dataset-${Date.now()}`
      const job = startedDatasetJob({
        id,
        kind: input.kind ?? 'generate',
        moduleId: input.moduleId,
        executor: input.executor,
        params: input.params,
        endpoint: input.endpoint,
      })

      if (input.executor === 'backend') {
        record(job)
        if (!client) {
          patch(id, { status: 'failed', error: 'No studio-backend connected to run this job.', finishedAtMs: Date.now() })
          return job
        }
        void client
          .createJob(input.moduleId, input.params, id)
          .then(() => patch(id, { status: 'queued' }))
          .catch((err: unknown) =>
            patch(id, {
              status: 'failed',
              error: err instanceof Error ? err.message : String(err),
              finishedAtMs: Date.now(),
            }),
          )
        return job
      }

      // Browser executor — run it here so the rail sees live progress.
      record({ ...job, status: 'running' })
      if (runningRef.current) {
        patch(id, { status: 'failed', error: 'A browser generation is already running.', finishedAtMs: Date.now() })
        return job
      }
      runningRef.current = true
      try {
        const { manifest, zipBytes } = await generateDatasetInBrowser(
          {
            engine: input.params.engine ?? '',
            ...input.params,
            phrases: toList(input.params.phrases, []),
            languages: toList(input.params.languages, ['en-US']),
          },
          (p) => {
            patch(id, {
              status: 'running',
              progress: p.total ? Math.min(1, p.done / p.total) : 0,
              logTail: [...(job.logTail ?? []), p.message],
            })
          },
        )
        let finalManifest = manifest
        if (input.cloud?.repoId && input.cloud.token) {
          await pushToHuggingFace({ repoId: input.cloud.repoId, token: input.cloud.token, zipBytes })
          finalManifest = {
            ...manifest,
            storage: { ...(manifest.storage ?? { backend: '' }), cloud: `hf://${input.cloud.repoId}` },
          }
          patch(id, {
            logTail: [...(job.logTail ?? []), `pushed to hf://${input.cloud.repoId}`],
          })
        }
        await saveLocalDataset(finalManifest, zipBytes)
        patch(id, {
          status: 'succeeded',
          progress: 1,
          resultDatasetId: finalManifest.id,
          artifact: 'wake-studio-dataset.zip',
          finishedAtMs: Date.now(),
        })
        return { ...job, status: 'succeeded', resultDatasetId: finalManifest.id }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        patch(id, { status: 'failed', error: message, finishedAtMs: Date.now() })
        return { ...job, status: 'failed', error: message }
      } finally {
        runningRef.current = false
      }
    },
    [client, record, patch],
  )

  /** Merge live backend state into a job (from the details pane's useStudioJob). */
  const applyLive = useCallback(
    (
      id: string,
      live: Pick<StudioJob, 'status' | 'progress' | 'error' | 'finishedAtMs' | 'logTail' | 'artifacts'>,
    ) => {
      patch(id, {
        ...(live.status ? { status: live.status } : {}),
        ...(live.progress !== undefined && live.progress !== null ? { progress: live.progress } : {}),
        ...(live.error !== undefined && live.error !== null ? { error: live.error } : {}),
        ...(live.finishedAtMs !== undefined && live.finishedAtMs !== null ? { finishedAtMs: live.finishedAtMs } : {}),
        ...(live.logTail ? { logTail: live.logTail } : {}),
        ...(live.artifacts?.length ? { artifact: live.artifacts[0] } : {}),
      })
    },
    [patch],
  )

  /** Submit a quality op (check-dataset / dataset-split) on the BACKEND ONLY.
   *
   * These ops analyze/mix real store bytes, so there is no browser executor
   * in v1 (#209) — the action is hidden without a connected studio-backend.
   * Returns the recorded job; the details pane live-tracks it. */
  const submitQuality = useCallback(
    async (op: 'check' | 'split', params: Record<string, string>): Promise<DatasetJob | null> => {
      const moduleId = op === 'check' ? 'dataset-check' : 'dataset-split'
      const kind = op
      const id = `dataset-${Date.now()}`
      if (!client) {
        return null
      }
      const job = startedDatasetJob({
        id,
        kind,
        moduleId,
        executor: 'backend',
        params,
      })
      record(job)
      void client
        .createJob(moduleId, params, id)
        .then(() => patch(id, { status: 'queued' }))
        .catch((err: unknown) =>
          patch(id, {
            status: 'failed',
            error: err instanceof Error ? err.message : String(err),
            finishedAtMs: Date.now(),
          }),
        )
      return job
    },
    [client, record, patch],
  )

  const remove = useCallback((id: string) => {
    setJobs((prev) => prev.filter((j) => j.id !== id))
    void deleteDatasetJob(id)
  }, [])

  return { jobs, submitGenerate, submitQuality, applyLive, patch, remove, refresh: () => listDatasetJobs().then(setJobs) }
}
