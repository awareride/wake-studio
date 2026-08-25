/**
 * Datasets — OPFS-backed canonical archive store (ADR-045, #220).
 *
 * Browser-local dataset FILE BYTES live in the Origin Private File System
 * (OPFS), never in IndexedDB: one `wake-studio-dataset.zip` per dataset under
 * `datasets/<id>/`, kept AS IMPORTED (zip form — no eager unpack, per ADR-045
 * decision 4; large datasets cost nothing at rest).
 *
 * Reads are the "per-clip random access" of §8.3: the listener lists clips
 * from the zip's central-directory tail (bounded reads, no full download) and
 * extracts a single entry with `@wake-studio/module-dataset`'s
 * `extractZipEntrySlice` — memory stays bounded to one clip.
 *
 * All functions accept an optional injected OPFS root (tests pass in-memory
 * fakes); production callers default to `navigator.storage.getDirectory()`.
 */

import {
  extractZipEntrySlice,
  findZipEnd,
  parseCentralDirectory,
  ZIP_EOCD_MAX_COMMENT,
  type ZipEntryInfo,
} from '@wake-studio/module-dataset'

export class DatasetStorageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DatasetStorageError'
  }
}

export const DATASET_ZIP_NAME = 'wake-studio-dataset.zip'
/** Zip tail scanning never needs more than EOCD_MIN_LEN(22) + max comment. */
const EOCD_MAX_TAIL = 22 + ZIP_EOCD_MAX_COMMENT
const LOCAL_HDR_MIN_LEN = 30

/** True when the browser exposes OPFS (Origin Private File System). */
export function isOpfsAvailable(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.storage !== 'undefined' &&
    typeof navigator.storage.getDirectory === 'function'
  )
}

// Injection seam for the #220 unit tests (Node has no OPFS): a provider set
// here is honored by getDatasetRoot so every OPFS call in this module resolves
// to the in-memory fake. Production callers leave it unset.
type RootProvider = () => Promise<FileSystemDirectoryHandle>
let rootProvider: RootProvider | null = null

export function setOpfsRootProvider(provider: RootProvider | null): void {
  rootProvider = provider
}

/** The `datasets/` directory in the OPFS origin root. */
export async function getDatasetRoot(): Promise<FileSystemDirectoryHandle> {
  if (rootProvider) return rootProvider()
  if (!isOpfsAvailable()) {
    throw new DatasetStorageError(
      'This browser has no Origin Private File System (OPFS) — local datasets cannot be stored.',
    )
  }
  const base = await navigator.storage.getDirectory()
  return base.getDirectoryHandle('datasets', { create: true })
}

/** Open `datasets/<id>/` (read path — null when the dataset is not here). */
async function openDatasetDir(
  root: FileSystemDirectoryHandle,
  id: string,
): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await root.getDirectoryHandle(id)
  } catch {
    return null
  }
}

/** Open `datasets/<id>/wake-studio-dataset.zip` (read path). */
async function openZipFile(dir: FileSystemDirectoryHandle): Promise<FileSystemFileHandle | null> {
  try {
    return await dir.getFileHandle(DATASET_ZIP_NAME)
  } catch {
    return null
  }
}

/** The dataset's zip as a `File` (null when absent). */
async function datasetZipFile(id: string, root?: FileSystemDirectoryHandle): Promise<File | null> {
  const base = root ?? (await getDatasetRoot())
  const dir = await openDatasetDir(base, id)
  if (!dir) return null
  const fh = await openZipFile(dir)
  if (!fh) return null
  return fh.getFile()
}

/** Persist a dataset's canonical zip under `datasets/<id>/`. */
export async function writeDatasetZip(
  id: string,
  bytes: Uint8Array,
  root?: FileSystemDirectoryHandle,
): Promise<void> {
  const base = root ?? (await getDatasetRoot())
  const dir = await base.getDirectoryHandle(id, { create: true })
  const fh = await dir.getFileHandle(DATASET_ZIP_NAME, { create: true })
  const writable = await fh.createWritable()
  try {
    await writable.write(bytes)
  } finally {
    await writable.close()
  }
}

/** The whole canonical zip of a local dataset (explicit download/upload only —
 *  the listener never reads the whole archive). */
export async function readDatasetZipBytes(
  id: string,
  root?: FileSystemDirectoryHandle,
): Promise<Uint8Array | null> {
  const file = await datasetZipFile(id, root)
  if (!file) return null
  return new Uint8Array(await file.arrayBuffer())
}

/** Delete `datasets/<id>/` (zip + future unpacked dir) — a no-op when absent. */
export async function deleteDatasetZip(
  id: string,
  root?: FileSystemDirectoryHandle,
): Promise<void> {
  const base = root ?? (await getDatasetRoot())
  try {
    await base.removeEntry(id, { recursive: true })
  } catch {
    /* already gone */
  }
}

/** One clip in the canonical `audio/<label>/` tree. */
export interface DatasetClipRef {
  label: string
  /** The stored file name, e.g. `0001.wav`. */
  name: string
  /** The archive entry path, e.g. `audio/hey_studio/0001.wav`. */
  path: string
}

/**
 * Parse the central directory of a zip `File` with bounded reads: only the
 * tail (≤ 65557 bytes) plus — when the directory is not fully inside the tail —
 * the exact `cdSize` slice are read.
 */
async function zipEntryInfos(file: File): Promise<ZipEntryInfo[]> {
  const tailStart = Math.max(0, file.size - EOCD_MAX_TAIL)
  const tail = new Uint8Array(await file.slice(tailStart).arrayBuffer())
  const end = findZipEnd(tail)
  let cd: Uint8Array
  if (end.cdOffset >= tailStart) {
    cd = tail.subarray(end.cdOffset - tailStart)
  } else {
    cd = new Uint8Array(await file.slice(end.cdOffset, end.cdOffset + end.cdSize).arrayBuffer())
  }
  return parseCentralDirectory(cd, end.totalEntries)
}

/** List the `audio/<label>/<file>` clips of a local dataset (empty when absent). */
export async function listDatasetClips(
  id: string,
  root?: FileSystemDirectoryHandle,
): Promise<DatasetClipRef[]> {
  const file = await datasetZipFile(id, root)
  if (!file) return []
  const clips: DatasetClipRef[] = []
  for (const entry of await zipEntryInfos(file)) {
    if (!entry.name.startsWith('audio/')) continue
    const rest = entry.name.slice('audio/'.length)
    const slash = rest.indexOf('/')
    if (slash <= 0 || slash === rest.length - 1) continue
    clips.push({ label: rest.slice(0, slash), name: rest.slice(slash + 1), path: entry.name })
  }
  return clips
}

/** Read ONE clip's WAV bytes from a local dataset (bounded: one entry only). */
export async function readDatasetClipBytes(
  id: string,
  path: string,
  root?: FileSystemDirectoryHandle,
): Promise<Uint8Array> {
  const file = await datasetZipFile(id, root)
  if (!file) throw new DatasetStorageError(`Local dataset “${id}” has no stored archive.`)
  const entries = await zipEntryInfos(file)
  const entry = entries.find((e) => e.name === path)
  if (!entry) throw new DatasetStorageError(`Clip “${path}” is not in dataset “${id}”.`)
  // Local header: method @8, compressed size @18, name length @26, extra @28.
  const hdr = new Uint8Array(
    await file.slice(entry.localHeaderOffset, entry.localHeaderOffset + LOCAL_HDR_MIN_LEN).arrayBuffer(),
  )
  const nameLen = hdr[26] | (hdr[27] << 8)
  const extraLen = hdr[28] | (hdr[29] << 8)
  const compressedSize = entry.compressedSize
  const regionLen = LOCAL_HDR_MIN_LEN + nameLen + extraLen + compressedSize
  const region = new Uint8Array(
    await file.slice(entry.localHeaderOffset, entry.localHeaderOffset + regionLen).arrayBuffer(),
  )
  return extractZipEntrySlice(region)
}