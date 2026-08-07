/**
 * Persistent clip store (epic #53 P5).
 *
 * IndexedDB `wake-studio-clips`: a session history of captured per-stage
 * audio. Each clip stores the WAV bytes (Blob) + metadata (stage, project,
 * duration, sample rate) so the list survives reload and replay is instant.
 */

import type { PersistStageId } from '../types'
import { encodeWav } from './wav'

const DB_NAME = 'wake-studio-clips'
const DB_VERSION = 1
const CLIP_STORE = 'clips'

export interface SavedClip {
  id: string
  stageId: PersistStageId
  /** Human label for the clip (e.g. file name). */
  name: string
  projectId?: string
  durationMs: number
  sampleRate: number
  /** WAV bytes. */
  blob: Blob
  createdAtMs: number
}

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(CLIP_STORE)) {
        const store = db.createObjectStore(CLIP_STORE, { keyPath: 'id' })
        store.createIndex('stageId', 'stageId')
        store.createIndex('projectId', 'projectId')
        store.createIndex('createdAtMs', 'createdAtMs')
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
        const t = db.transaction(CLIP_STORE, mode)
        const req = fn(t.objectStore(CLIP_STORE))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      }),
  )
}

/** Save a clip; returns the stored record. */
export async function saveClip(
  clip: Omit<SavedClip, 'createdAtMs'> & { createdAtMs?: number },
): Promise<SavedClip> {
  const stored: SavedClip = { ...clip, createdAtMs: clip.createdAtMs ?? Date.now() }
  await tx('readwrite', (store) => store.put(stored))
  return stored
}

/** List clips, newest first. */
export async function listClips(): Promise<SavedClip[]> {
  const all = await tx('readonly', (store) => store.getAll())
  return all.sort((a, b) => b.createdAtMs - a.createdAtMs)
}

/** List clips for a project (or all when projectId omitted). */
export async function listClipsForProject(projectId?: string): Promise<SavedClip[]> {
  if (!projectId) return listClips()
  const all = await listClips()
  return all.filter((c) => c.projectId === projectId)
}

/** Delete a clip by id. */
export async function deleteClip(id: string): Promise<void> {
  await tx('readwrite', (store) => store.delete(id))
}

/** Clear all clips. */
export async function clearClips(): Promise<void> {
  await tx('readwrite', (store) => store.clear())
}

function uid(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/** Build a clip record from PCM + metadata (also produces the WAV bytes). */
export function buildClip(
  stageId: PersistStageId,
  samples: Float32Array,
  sampleRate: number,
  projectId?: string,
  name?: string,
): SavedClip {
  const wav = encodeWavToBlob(samples, sampleRate)
  return {
    id: uid(),
    stageId,
    name: name ?? `clip-${stageId}-${Date.now()}`,
    projectId,
    durationMs: Math.round((samples.length / sampleRate) * 1000),
    sampleRate,
    blob: wav,
    createdAtMs: Date.now(),
  }
}

function encodeWavToBlob(samples: Float32Array, sampleRate: number): Blob {
  const bytes = encodeWav(samples, sampleRate)
  return new Blob([bytes], { type: 'audio/wav' })
}
