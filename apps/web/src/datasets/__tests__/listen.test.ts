/**
 * Datasets — review & listen gating (ADR-045 §8.3, #220).
 *
 * The in-app player is offered only where single-clip random access is cheap.
 * The §8.3 table is implemented as: local (OPFS) datasets are listensable
 * today; backend (remote zip blob) and built-in (remote reference) forms are
 * not — cloud directories become listensable once dir-form cloud push lands.
 */

import { describe, expect, it } from 'vitest'
import { datasetIsListenable, listListenableClips } from '../listen'
import type { ConsoleDataset } from '../store'

function makeDataset(overrides: Partial<ConsoleDataset> = {}): ConsoleDataset {
  return {
    id: 'd-1',
    name: 'Set',
    version: 1,
    kind: 'generated',
    role: 'mixed',
    clips: 4,
    roles: ['positive'],
    license: 'user-owned',
    commercialUse: true,
    available: true,
    manifest: {
      schemaVersion: 1,
      id: 'd-1',
      name: 'Set',
      version: 1,
      kind: 'generated',
      role: 'mixed',
      audio: { sampleRate: 16000, channels: 1, encoding: 'pcm_s16le', clips: 4, durationSec: 8 },
      labels: [{ name: 'hey', role: 'positive' }],
      provenance: [{ name: 't', license: 'user-owned', commercialUse: true }],
      storage: { backend: '' },
      createdAtMs: 1,
    },
    origin: 'local',
    sizeBytes: 100,
    ...overrides,
  }
}

describe('datasetIsListenable (§8.3)', () => {
  it('local (OPFS) datasets are listensable — single-entry zip reads', () => {
    expect(datasetIsListenable(makeDataset({ origin: 'local' }))).toBe(true)
  })

  it('backend datasets (remote zip blob) are NOT listensable yet', () => {
    expect(datasetIsListenable(makeDataset({ origin: 'backend' }))).toBe(false)
  })

  it('built-in references are NOT listensable', () => {
    expect(datasetIsListenable(makeDataset({ origin: 'builtin' }))).toBe(false)
  })
})

describe('listListenableClips', () => {
  it('returns [] for a non-listenable dataset form', async () => {
    expect(await listListenableClips(makeDataset({ origin: 'backend' }))).toEqual([])
  })
})