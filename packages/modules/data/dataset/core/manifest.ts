/**
 * Dataset module - the single dataset importer (ADR-044, task #203).
 *
 * Mirrors the trained-bundle importer (training module `manifest.ts`): ONE
 * importer validates + reads any `wake-studio-dataset.zip` so every producer
 * (built-in catalog, generation job, upload) and every consumer (the Datasets
 * console, the training wizard's `datasets[]` picker) share one code path.
 *
 * The zip layout (docs/modules/data-sources.md §4.1):
 *
 * ```
 * wake-studio-dataset.zip
 * ├── dataset.json          <-- the portability contract (see ./spec)
 * └── audio/
 *     ├── <label>/<clip>.wav   (16 kHz mono PCM WAV, canonical)
 *     └── ...
 * ```
 */

import { unzipSync } from 'fflate'
import {
  validateDatasetManifest,
  type DatasetManifest,
  type DatasetLabel,
} from './spec'
import { datasetContentHash, type ClipTree } from './hash'

/** A parsed + validated dataset: the manifest + its canonical clip tree. */
export interface DatasetBundle {
  manifest: DatasetManifest
  /** label -> clips, sorted by clip name (the canonical `audio/<label>/*.wav` tree). */
  clips: ClipTree
}

/**
 * Error raised by {@link importDatasetZip} when the picked file is not a valid
 * dataset. `code` lets the UI show a precise message (mirrors
 * `BundleImportError` in the training module).
 */
export class DatasetImportError extends Error {
  /** Stable machine-readable code (surfaced in the UI + tests). */
  readonly code: DatasetImportErrorCode

  constructor(code: DatasetImportErrorCode, message: string) {
    super(message)
    this.name = 'DatasetImportError'
    this.code = code
  }
}

export type DatasetImportErrorCode =
  | 'no-zip'
  | 'empty-zip'
  | 'missing-manifest'
  | 'invalid-manifest'
  | 'invalid-encoding'
  | 'missing-clips'
  | 'content-mismatch'

/** Messages shown to the user for each {@link DatasetImportErrorCode}. */
export const DATASET_IMPORT_ERROR_MESSAGES: Record<DatasetImportErrorCode, string> = {
  'no-zip': "That file isn't a zip archive — pick a wake-studio-dataset.zip.",
  'empty-zip': 'The zip is empty — it should contain dataset.json and an audio/ tree.',
  'missing-manifest':
    'dataset.json is missing from the zip (the dataset portability contract).',
  'invalid-manifest':
    'dataset.json is invalid — it must declare id/name/version, semantic label roles and provenance (see docs/modules/data-sources.md §4.2).',
  'invalid-encoding':
    'The manifest declares a non-canonical audio encoding — datasets store 16 kHz mono PCM WAV (derived formats are materialized, not stored).',
  'missing-clips':
    "Every declared label must have at least one clip in audio/<label>/ — some labels have none.",
  'content-mismatch':
    "The dataset's contentHash doesn't match its audio — the archive was modified or corrupted. Re-import the original zip.",
}

/**
 * Parse a `File` (or node Buffer) that is a `wake-studio-dataset.zip` into a
 * {@link DatasetBundle}. Client-side only — no WakeStudio server involved.
 *
 * Steps:
 * 1. Unzip + find `dataset.json` (matched by basename, like the bundle importer).
 * 2. Validate it against the manifest contract ({@link validateDatasetManifest}).
 * 3. Index the canonical `audio/<label>/*.wav` tree; every declared label must
 *    have >= 1 clip.
 * 4. When `contentHash` is present, recompute it over the canonical payload and
 *    compare — a mismatch means the archive was modified (content-mismatch).
 *
 * @throws {DatasetImportError} with a stable `code` on any invalid/missing part.
 */
export async function importDatasetZip(
  input: File | ArrayBuffer | Uint8Array,
): Promise<DatasetBundle> {
  const data = input instanceof Uint8Array ? input : await readZipBytes(input)
  if (data.byteLength === 0) {
    throw new DatasetImportError('no-zip', DATASET_IMPORT_ERROR_MESSAGES['no-zip'])
  }

  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(data)
  } catch {
    throw new DatasetImportError('no-zip', DATASET_IMPORT_ERROR_MESSAGES['no-zip'])
  }

  const names = Object.keys(entries)
  if (names.length === 0) {
    throw new DatasetImportError('empty-zip', DATASET_IMPORT_ERROR_MESSAGES['empty-zip'])
  }

  const decoder = new TextDecoder()
  const byName = new Map<string, Uint8Array>()
  for (const name of names) {
    const base = name.split('/').pop() ?? name
    if (!byName.has(base)) byName.set(base, entries[name])
  }

  const manifestBytes = byName.get('dataset.json')
  if (!manifestBytes) {
    throw new DatasetImportError(
      'missing-manifest',
      DATASET_IMPORT_ERROR_MESSAGES['missing-manifest'],
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(decoder.decode(manifestBytes))
  } catch {
    throw new DatasetImportError(
      'invalid-manifest',
      DATASET_IMPORT_ERROR_MESSAGES['invalid-manifest'],
    )
  }

  const validation = validateDatasetManifest(parsed)
  if (!validation.ok) {
    throw new DatasetImportError(
      'invalid-manifest',
      `${DATASET_IMPORT_ERROR_MESSAGES['invalid-manifest']} (${validation.errors.join('; ')})`,
    )
  }
  const manifest = parsed as DatasetManifest

  if (manifest.audio.encoding !== 'pcm_s16le') {
    throw new DatasetImportError(
      'invalid-encoding',
      DATASET_IMPORT_ERROR_MESSAGES['invalid-encoding'],
    )
  }

  // Index the canonical audio/<label>/*.wav tree (clips sorted by name for a
  // deterministic content hash, independent of zip entry order).
  const clips: ClipTree = {}
  for (const name of names) {
    const match = /^audio\/([^/]+)\/(.+)$/.exec(name)
    if (!match) continue
    const [, label, clipName] = match
    if (!/\.wav$/i.test(clipName)) continue
    ;(clips[label] ??= []).push({ name: clipName, bytes: entries[name] })
  }
  for (const label of Object.keys(clips)) {
    clips[label].sort((a, b) => (a.name < b.name ? -1 : 1))
  }

  // Every declared label must have >= 1 clip (structural validity; the quality
  // gate in #209 refines the empty-label warnings/messaging).
  const missing = (manifest.labels as DatasetLabel[]).filter((l) => !(clips[l.name]?.length))
  if (missing.length > 0) {
    throw new DatasetImportError(
      'missing-clips',
      `${DATASET_IMPORT_ERROR_MESSAGES['missing-clips']} (empty labels: ${missing
        .map((l) => l.name)
        .join(', ')})`,
    )
  }

  // Optional integrity check: contentHash must match the canonical payload.
  if (manifest.contentHash) {
    const actual = await datasetContentHash(manifest, clips)
    if (actual !== manifest.contentHash) {
      throw new DatasetImportError(
        'content-mismatch',
        DATASET_IMPORT_ERROR_MESSAGES['content-mismatch'],
      )
    }
  }

  return { manifest, clips }
}

async function readZipBytes(input: File | ArrayBuffer): Promise<Uint8Array> {
  if (input instanceof ArrayBuffer) return new Uint8Array(input)
  return new Uint8Array(await input.arrayBuffer())
}
