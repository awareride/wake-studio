/**
 * Projects store - IndexedDB persistence for wake-word projects.
 *
 * Generalizes the Few-Shot storage pattern (src/few-shot/storage.ts) into a
 * project-level store. Projects are small (config snapshots + id lists);
 * audio samples and prototypes keep their own stores (the Few-Shot store).
 *
 * Phase 2 scope: minimal CRUD (create / list / get / update / delete) plus
 * ordering by updatedAt. Samples/prototypes stay in the Few-Shot stores until
 * the workspace wires them together.
 */

import type { WakeWordProject } from './types'

const DB_NAME = 'wake-studio-console'
const DB_VERSION = 1
const PROJECT_STORE = 'projects'

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(PROJECT_STORE)) {
        // Keyed by project id; updatedAt index for "recent projects" list.
        const store = db.createObjectStore(PROJECT_STORE, { keyPath: 'id' })
        store.createIndex('updatedAt', 'updatedAtMs')
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
        const t = db.transaction(PROJECT_STORE, mode)
        const req = fn(t.objectStore(PROJECT_STORE))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      }),
  )
}

/** List projects, most recently updated first. */
export async function listProjects(): Promise<WakeWordProject[]> {
  const all = await tx('readonly', (store) => store.getAll())
  return all.sort((a, b) => b.updatedAtMs - a.updatedAtMs)
}

export async function getProject(id: string): Promise<WakeWordProject | undefined> {
  return tx('readonly', (store) => store.get(id))
}

/** Create or overwrite a project. Returns the stored project. */
export async function saveProject(project: WakeWordProject): Promise<WakeWordProject> {
  await tx('readwrite', (store) => store.put(project))
  return project
}

export async function deleteProject(id: string): Promise<void> {
  await tx('readwrite', (store) => store.delete(id))
}

export async function clearProjects(): Promise<void> {
  await tx('readwrite', (store) => store.clear())
}
