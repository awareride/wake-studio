/**
 * User model library - IndexedDB persistence for user-supplied KWS models.
 *
 * Stores model binaries (Blob) + metadata. Two sources feed it:
 *   1. a local file picked with `<input type="file">` (the user imports a
 *      .onnx model from disk), and
 *   2. a model trained with this platform (future: the training module's
 *      artifact bundle lands here too).
 *
 * Models are stored client-side only (never transmitted, ADR-013 amendment).
 * A stored model can be:
 *   - selected in the KWS panel's Model-source editor (loaded via a Blob URL),
 *   - exported back to disk (download the original .onnx file), and
 *   - removed.
 *
 * The export format is the raw model file plus a sidecar .json descriptor so
 * a model can be moved to another machine or re-imported.
 */

import type { ProvisionArtifact, ProvisionKind } from '@wake-studio/contracts'

const DB_NAME = 'wake-studio-user-models'
const DB_VERSION = 1
const MODEL_STORE = 'models'

export interface UserModel {
  /** Legacy entries (pre-ADR-033) have no kind; treated as models. */
  kind?: 'model'
  id: string
  /** Role this model was imported for (classifier / melspectrogram / ...). */
  role: string
  /** Original file name (e.g. my-wakeword-classifier.onnx). */
  name: string
  /** File size in bytes. */
  sizeBytes: number
  /** Model format (onnx today). */
  format: string
  /** Import time (ms epoch). */
  createdAtMs: number
  /** Notes (source, provenance, license the user declared). */
  notes?: string
  /** The model binary. */
  blob: Blob
}

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(MODEL_STORE)) {
        db.createObjectStore(MODEL_STORE, { keyPath: 'id' })
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
        const t = db.transaction(MODEL_STORE, mode)
        const req = fn(t.objectStore(MODEL_STORE))
        req.onsuccess = () => resolve(req.result as T)
        req.onerror = () => reject(req.error)
      }),
  )
}

/** Import a local File into the user model library. */
export async function importModelFile(
  file: File,
  role: string,
  notes?: string,
): Promise<UserModel> {
  const model: UserModel = {
    id: `model-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    name: file.name,
    sizeBytes: file.size,
    format: 'onnx',
    createdAtMs: Date.now(),
    notes,
    blob: file,
  }
  await tx('readwrite', (s) => s.put(model))
  return model
}

/** List all stored user models (artifacts excluded - they are provisioned
 *  artifacts, not importable model binaries). */
export async function listUserModels(): Promise<UserModel[]> {
  const all = await tx<unknown[]>('readonly', (s) => s.getAll())
  return (all as Array<UserModel | UserArtifact>)
    .filter((e): e is UserModel => e.kind !== 'artifact')
    .sort((a, b) => b.createdAtMs - a.createdAtMs)
}

/** Delete a stored user model. */
export async function deleteUserModel(id: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(id))
}

/**
 * Export a stored model back to disk: downloads the original file plus a
 * sidecar .json descriptor (id, role, name, size, date) so it can be
 * re-imported or moved to another machine.
 */
export async function exportUserModel(model: UserModel): Promise<void> {
  const url = URL.createObjectURL(model.blob)
  const a = document.createElement('a')
  a.href = url
  a.download = model.name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)

  // Sidecar descriptor (JSON), so the model can be re-imported elsewhere.
  const descriptor = {
    id: model.id,
    role: model.role,
    name: model.name,
    sizeBytes: model.sizeBytes,
    format: model.format,
    createdAtMs: model.createdAtMs,
    notes: model.notes,
  }
  const dUrl = URL.createObjectURL(
    new Blob([JSON.stringify(descriptor, null, 2)], {
      type: 'application/json',
    }),
  )
  const da = document.createElement('a')
  da.href = dUrl
  da.download = `${model.name}.json`
  document.body.appendChild(da)
  da.click()
  da.remove()
  setTimeout(() => URL.revokeObjectURL(dUrl), 1000)
}

/** Get a Blob URL for a stored model (for the KWS backend loader). */
export async function blobUrlForModel(id: string): Promise<string | null> {
  const model = await tx<UserModel | undefined>('readonly', (s) => s.get(id))
  if (!model) return null
  return URL.createObjectURL(model.blob)
}

// ---------------------------------------------------------------------------
// Provisioned artifacts (ADR-033).
//
// The same library that holds imported models also holds provisioning
// artifacts (enrolled prototypes today; keyword lists and trained classifiers
// later) so they are one browsable collection. Entries are plain JSON
// (structured-clone-able: number[] vectors, no Float32Array/Blob), so they
// share the existing 'models' object store without a schema bump - entries
// without a `kind` are legacy models.
// ---------------------------------------------------------------------------

/** A provisioned artifact stored in the user library (ADR-033). */
export interface UserArtifact {
  kind: 'artifact'
  id: string
  /** Which provisioning kind produced it ('prototype' | 'list' | 'train'). */
  artifactType: ProvisionKind
  /** The backend this artifact provisions (e.g. 'plixkws'). */
  backendId: string
  /** Display name (e.g. the enrolled wake word). */
  name: string
  /** Approximate size in bytes of the serialized payload. */
  sizeBytes: number
  createdAtMs: number
  notes?: string
  /** The serialized artifact (contracts provisioning payload). */
  artifact: ProvisionArtifact
}

/** Persist a provisioned artifact into the shared user library. */
export async function saveProvisionArtifact(
  artifact: ProvisionArtifact,
  meta: { name: string; notes?: string },
): Promise<UserArtifact> {
  const entry: UserArtifact = {
    kind: 'artifact',
    id: `artifact-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    artifactType: artifact.kind,
    backendId: artifact.backendId,
    name: meta.name,
    sizeBytes: JSON.stringify(artifact).length,
    createdAtMs: Date.now(),
    notes: meta.notes,
    artifact,
  }
  await tx('readwrite', (s) => s.put(entry))
  return entry
}

/** List all stored provisioning artifacts (newest first). */
export async function listProvisionArtifacts(): Promise<UserArtifact[]> {
  const all = await tx<unknown[]>('readonly', (s) => s.getAll())
  return (all as Array<UserArtifact | UserModel>)
    .filter((e): e is UserArtifact => e.kind === 'artifact')
    .sort((a, b) => b.createdAtMs - a.createdAtMs)
}

/** Look up one stored provisioning artifact. */
export async function getProvisionArtifact(
  id: string,
): Promise<UserArtifact | undefined> {
  const entry = await tx<UserArtifact | UserModel | undefined>(
    'readonly',
    (s) => s.get(id),
  )
  return entry && entry.kind === 'artifact' ? (entry as UserArtifact) : undefined
}

/** Delete a stored provisioning artifact. */
export async function deleteProvisionArtifact(id: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(id))
}
