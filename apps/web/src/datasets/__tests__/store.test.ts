/**
 * Datasets — consolidated store merge logic (ADR-044 §8.2, #208).
 *
 * The `mergeDatasets` function is pure (no DOM/IndexedDB/network) so it is
 * L1-testable here: same-id datasets from multiple origins collapse into one
 * row (local > backend > builtin), and each row derives the fields the
 * console rail + details render (clips, roles, license, commercialUse).
 */

import { describe, expect, it } from 'vitest'
import {
  fromBackendStore,
  fromBuiltinCatalog,
  fromLocal,
  mergeDatasets,
  type ConsoleDataset,
} from '../store'
import type { StoreDataset } from '../../training/studio-client'
import type { DatasetCatalogEntry } from '@wake-studio/module-dataset'
import type { LocalDatasetSummary } from '../local-store'

const builtinManifest = {
  schemaVersion: 1,
  id: 'speech-commands-v2',
  name: 'Google Speech Commands V2',
  version: 1,
  kind: 'builtin',
  role: 'unknowns',
  audio: { sampleRate: 16000, channels: 1, encoding: 'pcm_s16le', clips: 105829, durationSec: 264573 },
  labels: [
    { name: 'yes', role: 'unknown' },
    { name: '_background_noise_', role: 'noise' },
  ],
  provenance: [
    { name: 'Google Speech Commands V2', license: 'CC BY 4.0', source: 'https://example.test/sc2', commercialUse: true },
  ],
  storage: { backend: 'datasets/speech-commands-v2/' },
  createdAtMs: 1,
}

function makeBuiltin(id = 'speech-commands-v2'): DatasetCatalogEntry {
  return {
    ...builtinManifest,
    id,
    materialize: { type: 'speech-commands-v2' },
  } as unknown as DatasetCatalogEntry
}

function makeBackend(overrides: Partial<StoreDataset> = {}): StoreDataset {
  return {
    id: 'gen-1',
    name: 'Generated set',
    version: 1,
    kind: 'generated',
    role: 'mixed',
    sizeBytes: 4096,
    createdAtMs: 10,
    manifest: {
      audio: { sampleRate: 16000, channels: 1, clips: 6, durationSec: 12 },
      labels: [
        { name: 'hey studio', role: 'positive' },
        { name: 'goodbye', role: 'unknown' },
      ],
      provenance: [{ name: 'edge-tts synthetic', license: 'user-owned', commercialUse: true }],
    },
    ...overrides,
  } as StoreDataset
}

function makeLocal(overrides: Partial<LocalDatasetSummary> = {}): LocalDatasetSummary {
  return {
    id: 'local-1',
    sizeBytes: 2048,
    savedAtMs: 20,
    manifest: {
      schemaVersion: 1,
      id: 'local-1',
      name: 'Browser generated',
      version: 1,
      kind: 'generated',
      role: 'mixed',
      audio: { sampleRate: 16000, channels: 1, encoding: 'pcm_s16le', clips: 3, durationSec: 6 },
      labels: [{ name: 'wake up', role: 'positive' }],
      provenance: [{ name: 'mimo synthetic', license: 'user-owned', commercialUse: true }],
      createdAtMs: 20,
    },
    ...overrides,
  } as unknown as LocalDatasetSummary
}

describe('fromBackendStore', () => {
  it('derives the console fields from a GET /datasets record', () => {
    const d = fromBackendStore(makeBackend())
    expect(d.origin).toBe('backend')
    expect(d.kind).toBe('generated')
    expect(d.clips).toBe(6)
    expect(d.roles).toEqual(['positive', 'unknown'])
    expect(d.license).toBe('user-owned')
    expect(d.commercialUse).toBe(true)
    expect(d.sizeBytes).toBe(4096)
  })

  it('reads the cloud ref from the manifest storage block', () => {
    const m = makeBackend()
    m.manifest = {
      ...m.manifest,
      storage: { backend: 'datasets/x/', cloud: 'hf://u/ds' },
    } as StoreDataset['manifest'] & { storage: { backend: string; cloud: string } }
    expect(fromBackendStore(m).cloud).toBe('hf://u/ds')
  })
})

describe('fromBuiltinCatalog', () => {
  it('flags pending-host built-ins as unavailable', () => {
    const entry = makeBuiltin()
    entry.materialize = { type: 'pending-host', note: 'not hosted' }
    const d = fromBuiltinCatalog(entry)
    expect(d.available).toBe(false)
    expect(d.note).toBe('not hosted')
    expect(d.origin).toBe('builtin')
  })

  it('keeps available built-ins trainable', () => {
    expect(fromBuiltinCatalog(makeBuiltin()).available).toBe(true)
  })
})

describe('fromLocal', () => {
  it('maps a browser-local record to a console dataset', () => {
    const d = fromLocal(makeLocal())
    expect(d.origin).toBe('local')
    expect(d.kind).toBe('generated')
    expect(d.available).toBe(true)
  })
})

describe('mergeDatasets', () => {
  it('merges the three sources into one sorted list', () => {
    const merged = mergeDatasets([makeBackend()], [makeBuiltin()], [makeLocal()])
    const ids = merged.map((d) => d.id)
    expect(ids).toContain('speech-commands-v2')
    expect(ids).toContain('gen-1')
    expect(ids).toContain('local-1')
  })

  it('collapses same-id datasets — local wins, then backend, then builtin', () => {
    const backend = makeBackend({ id: 'dup', name: 'backend copy' })
    const local = makeLocal({ id: 'dup' })
    // builtin + backend + local all share id 'dup' -> local wins
    const byId = (list: ConsoleDataset[]) => list.find((d) => d.id === 'dup')!
    const merged = mergeDatasets([backend], [makeBuiltin('dup')], [local])
    expect(byId(merged).origin).toBe('local')

    // backend vs builtin -> backend wins
    const merged2 = mergeDatasets([backend], [makeBuiltin('dup')], [])
    expect(byId(merged2).origin).toBe('backend')

    // builtin alone survives
    const merged3 = mergeDatasets([], [makeBuiltin('dup')], [])
    expect(byId(merged3).origin).toBe('builtin')
  })

  it('handles an empty merge (no sources)', () => {
    expect(mergeDatasets([], [], [])).toEqual([])
  })
})
