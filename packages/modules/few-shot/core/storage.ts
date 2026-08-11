/**
 * Few-Shot module - IndexedDB persistence for prototypes and samples.
 *
 * Minimal wrapper (no external deps). Prototypes are small (a few hundred
 * floats); samples are larger (~64 KB each at 1 s / 16 kHz). Both are stored
 * locally and never transmitted (ADR-013 amendment).
 */

import type {
  EnrolledSample,
  SerializedPrototype,
  WakeWordPrototype,
} from './types'
import { deserializePrototype, serializePrototype } from './serialize'

const DB_NAME = 'wake-studio-few-shot'
const DB_VERSION = 1
const PROTO_STORE = 'prototypes'
const SAMPLE_STORE = 'samples'

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(PROTO_STORE)) {
        db.createObjectStore(PROTO_STORE, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(SAMPLE_STORE)) {
        db.createObjectStore(SAMPLE_STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function serialize(proto: WakeWordPrototype): SerializedPrototype {
  return serializePrototype(proto)
}

function deserialize(s: SerializedPrototype): WakeWordPrototype {
  return deserializePrototype(s)
}

export async function savePrototype(
  proto: WakeWordPrototype,
): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PROTO_STORE, 'readwrite')
    tx.objectStore(PROTO_STORE).put(serialize(proto))
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function listPrototypes(): Promise<WakeWordPrototype[]> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PROTO_STORE, 'readonly')
    const req = tx.objectStore(PROTO_STORE).getAll()
    req.onsuccess = () =>
      resolve((req.result as SerializedPrototype[]).map(deserialize))
    req.onerror = () => reject(req.error)
  })
}

export async function deletePrototype(id: string): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PROTO_STORE, 'readwrite')
    tx.objectStore(PROTO_STORE).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function saveSample(sample: EnrolledSample): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SAMPLE_STORE, 'readwrite')
    // Store audio + embedding as typed arrays (IndexedDB supports them).
    tx.objectStore(SAMPLE_STORE).put({
      id: sample.id,
      samples: sample.samples,
      sampleRate: sample.sampleRate,
      embedding: sample.embedding,
      quality: sample.quality,
      recordedAtMs: sample.recordedAtMs,
    })
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function deleteSample(id: string): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SAMPLE_STORE, 'readwrite')
    tx.objectStore(SAMPLE_STORE).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}
