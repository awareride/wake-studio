/**
 * Dataset content hashing (ADR-044 §4.2, task #203).
 *
 * `contentHash` is a sha256 over the CANONICAL payload — the manifest (minus
 * the self-referential `contentHash`/`storage` fields) plus every clip's bytes
 * in the `audio/<label>/` tree. Any content change changes the hash; per the
 * spec a changed hash must surface as a new `version`, so imports can detect a
 * silent dataset mutation.
 *
 * The byte layout is byte-identical to the backend mirror
 * (`wake_train_kit/dataset.py`) so a dataset produced/persisted by the backend
 * verifies in the browser and vice versa:
 *
 * ```
 * "dataset.json\n"
 * <stable JSON of the manifest minus contentHash+storage, sorted keys,
 *  `,`/`:` separators, raw UTF-8>\n
 * for each label (sorted), for each clip (sorted by name):
 *   "audio/<label>/<name>\n"  <clip bytes>  "\n"
 * ```
 *
 * Browser + node compatible: WebCrypto when available, `node:crypto` fallback.
 */

import type { DatasetManifest } from './spec'

/** One canonical clip in the `audio/<label>/` tree. */
export interface DatasetClip {
  name: string
  bytes: Uint8Array
}

/** label -> clips (the canonical `audio/<label>/*.wav` tree). */
export type ClipTree = Record<string, DatasetClip[]>

/**
 * Deterministic JSON serialization (sorted keys, `,`/`:` separators, raw
 * UTF-8) matching Python's `json.dumps(..., sort_keys=True, ensure_ascii=False,
 * separators=(',', ':'))` so both worlds hash the identical manifest bytes.
 */
export function stableJson(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    const keys = Object.keys(record).sort()
    return `{${keys
      .map((k) => `${JSON.stringify(k)}:${stableJson(record[k])}`)
      .join(',')}}`
  }
  throw new Error(`stableJson: unsupported value ${String(value)}`)
}

/**
 * The canonical payload bytes for hashing (see header for the exact layout).
 * Label and clip ordering is deterministic regardless of zip entry order.
 */
export function canonicalDatasetPayload(
  manifest: DatasetManifest,
  clips: ClipTree,
): Uint8Array {
  const { contentHash: _hash, storage: _storage, ...content } = manifest
  const encoder = new TextEncoder()
  const parts: Uint8Array[] = [encoder.encode('dataset.json\n')]
  parts.push(encoder.encode(`${stableJson(content)}\n`))

  for (const label of Object.keys(clips).sort()) {
    const clipList = [...clips[label]].sort((a, b) => (a.name < b.name ? -1 : 1))
    for (const clip of clipList) {
      parts.push(encoder.encode(`audio/${label}/${clip.name}\n`))
      parts.push(clip.bytes)
      parts.push(encoder.encode('\n'))
    }
  }

  const total = parts.reduce((n, p) => n + p.byteLength, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.byteLength
  }
  return out
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  // Browser / workers: WebCrypto.
  if (typeof crypto !== 'undefined' && typeof crypto.subtle !== 'undefined') {
    const digest = await crypto.subtle.digest('SHA-256', data as unknown as BufferSource)
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
  }
  // Node (vitest / backend tooling): node:crypto fallback.
  const { createHash } = await import('node:crypto')
  return createHash('sha256').update(data as unknown as Uint8Array).digest('hex')
}

/** Compute the dataset content hash (sha256, hex) over the canonical payload. */
export async function datasetContentHash(
  manifest: DatasetManifest,
  clips: ClipTree,
): Promise<string> {
  return sha256Hex(canonicalDatasetPayload(manifest, clips))
}
