/**
 * Datasets — generation/storage jobs (ADR-044 §8, #208).
 *
 * Generation jobs appear in the Datasets console rail with NDJSON progress —
 * the same job UI as Training. A job runs on ONE executor:
 *
 *   - backend: `POST /jobs` with moduleId `dataset-generate` / `dataset-storage`
 *     on a connected studio-backend; live state tracked via the shared
 *     StudioClient (SSE / polling), NDJSON progress surfaced like Training.
 *   - browser: `dataset-generate` runs client-side (online HTTP TTS); the job
 *     is local-only and progress is reported by the browser executor.
 *
 * Jobs persist to IndexedDB (like the Training history store) so the rail
 * survives reloads. Pure helpers (shape, ordering, upsert) are L1-testable.
 */

import type { GenerationExecutor } from './executor'

export type DatasetJobKind = 'generate' | 'storage'

/** Lifecycle status — the same vocabulary as TrainingJob (ADR-013). */
export type DatasetJobStatus =
  | 'queued'
  | 'running'
  | 'paused'
  | 'succeeded'
  | 'failed'
  | 'canceled'

export interface DatasetJob {
  id: string
  kind: DatasetJobKind
  moduleId: 'dataset-generate' | 'dataset-storage'
  status: DatasetJobStatus
  executor: GenerationExecutor
  /** Snapshot of the params the job ran with. */
  params: Record<string, string>
  startedAtMs: number
  finishedAtMs?: number
  /** The studio-backend endpoint this job is tracked on (backend jobs). */
  endpoint?: string
  error?: string
  /** Live progress 0..1 (NDJSON progress lines / browser executor). */
  progress?: number
  /** Live log lines (NDJSON log events / browser executor). */
  logTail?: string[]
  /** Backend artifact zip name (e.g. wake-studio-dataset.zip). */
  artifact?: string
  /** The generated dataset id (browser generate jobs; backend sets it after
   *  the store persists it — resolved via GET /datasets). */
  resultDatasetId?: string
}

export function startedDatasetJob(input: {
  id: string
  kind: DatasetJobKind
  moduleId: DatasetJob['moduleId']
  executor: GenerationExecutor
  params: Record<string, string>
  endpoint?: string
}): DatasetJob {
  return {
    id: input.id,
    kind: input.kind,
    moduleId: input.moduleId,
    status: 'queued',
    executor: input.executor,
    params: input.params,
    endpoint: input.endpoint,
    startedAtMs: Date.now(),
  }
}

/** Newest first (the rail's default order). */
export function sortJobsNewestFirst(jobs: readonly DatasetJob[]): DatasetJob[] {
  return [...jobs].sort((a, b) => b.startedAtMs - a.startedAtMs)
}

/** Insert or replace a job by id, preserving newest-first order. */
export function upsertJob(jobs: readonly DatasetJob[], job: DatasetJob): DatasetJob[] {
  return sortJobsNewestFirst([job, ...jobs.filter((j) => j.id !== job.id)])
}

// ---------------------------------------------------------------------------
// IndexedDB persistence (mirrors the local-datasets store pattern)
// ---------------------------------------------------------------------------

const DB_NAME = 'wake-studio-console'
const DB_VERSION = 1
const JOB_STORE = 'dataset-jobs'

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(JOB_STORE)) {
        db.createObjectStore(JOB_STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(JOB_STORE, mode)
        const req = fn(t.objectStore(JOB_STORE))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      }),
  )
}

/** List all recorded dataset jobs (newest first). */
export async function listDatasetJobs(): Promise<DatasetJob[]> {
  const all = (await tx('readonly', (store) => store.getAll())) as DatasetJob[]
  return sortJobsNewestFirst(all)
}

export async function saveDatasetJob(job: DatasetJob): Promise<void> {
  await tx('readwrite', (store) => store.put(job))
}

export async function deleteDatasetJob(id: string): Promise<void> {
  await tx('readwrite', (store) => store.delete(id))
}
