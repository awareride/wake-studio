/**
 * Training job history — IndexedDB persistence (issue #105).
 *
 * Thin wrapper over IndexedDB for the history rail: list / add / update /
 * clear. Keyed by job id, sorted by startedAtMs in the app. Mirrors the
 * projects-store pattern (apps/web/src/projects/store.ts); tests stub the
 * global `indexedDB` with an in-memory shim.
 */

import type { HistoryJob } from './history'

const DB_NAME = 'wake-studio-training'
const DB_VERSION = 1
const JOBS_STORE = 'jobs'

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(JOBS_STORE)) {
        const store = db.createObjectStore(JOBS_STORE, { keyPath: 'id' })
        store.createIndex('startedAtMs', 'startedAtMs')
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function tx<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(JOBS_STORE, mode)
        const req = fn(t.objectStore(JOBS_STORE))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      }),
  )
}

/** All recorded jobs (callers sort; see sortJobsNewestFirst). */
export async function listJobs(): Promise<HistoryJob[]> {
  return tx('readonly', (store) => store.getAll())
}

export async function getJob(id: string): Promise<HistoryJob | undefined> {
  return tx('readonly', (store) => store.get(id))
}

/** Insert or replace a job (id is the key). */
export async function saveJob(job: HistoryJob): Promise<void> {
  await tx('readwrite', (store) => store.put(job))
}

/** Mark a job finished with a new status (e.g. running → failed). */
export async function updateJobStatus(
  id: string,
  status: HistoryJob['status'],
  finishedAtMs?: number,
): Promise<void> {
  const job = await getJob(id)
  if (!job) return
  await saveJob({
    ...job,
    status,
    ...(finishedAtMs !== undefined ? { finishedAtMs } : {}),
  })
}

export async function clearJobs(): Promise<void> {
  await tx('readwrite', (store) => store.clear())
}