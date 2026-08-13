/**
 * L1 tests — training history model + news feed (issue #105).
 *
 * Derivation helpers for the train list and news: run starts, Colab imports,
 * ordering, upserts, and the derived news projection. Pure logic, no UI.
 * (The IndexedDB wrapper is tested via an in-memory shim in
 * history-store.test.ts.)
 */

import { describe, it, expect } from 'vitest'
import {
  startedJob,
  importedJob,
  backendToMethod,
  sortJobsNewestFirst,
  upsertJob,
  deriveNews,
  type HistoryJob,
} from '../core/history'
import type { ArtifactBundleMetadata, ArtifactProvenance } from '../core/manifest'

const METADATA: ArtifactBundleMetadata = {
  jobId: 'job-abc',
  moduleId: 'kws-openwakeword',
  backend: 'colab',
  params: { wakePhrase: 'hey studio', target: 'app-class' },
  trainedAtMs: 1_000,
}

/** A Colab bundle provenance that is user-owned (commercially clean). */
const USER_OWNED: ArtifactProvenance = { license: 'user-owned' }

describe('startedJob', () => {
  it('records a queued job from a local run start', () => {
    const job = startedJob({
      id: 'train-1',
      moduleId: 'kws-openwakeword',
      method: 'colab',
      backend: 'colab',
      params: { wakePhrase: 'hey studio', epochs: '50' },
      startedAtMs: 5_000,
    })
    expect(job.status).toBe('queued')
    expect(job.phrase).toBe('hey studio')
    expect(job.moduleId).toBe('kws-openwakeword')
    expect(job.method).toBe('colab')
    expect(job.backend).toBe('colab')
    expect(job.params.epochs).toBe('50')
    expect(job.startedAtMs).toBe(5_000)
    expect(job.artifactRef).toBeUndefined()
  })

  it("falls back to now for startedAtMs and '' for a missing phrase", () => {
    const before = Date.now()
    const job = startedJob({
      id: 'train-2',
      moduleId: 'rnnoise',
      method: 'ci',
      backend: 'self-hosted',
      params: {},
    })
    expect(job.startedAtMs).toBeGreaterThanOrEqual(before)
    expect(job.phrase).toBe('')
  })
})

describe('backendToMethod', () => {
  it('maps bundle backends to train methods', () => {
    expect(backendToMethod('colab')).toBe('colab')
    expect(backendToMethod('self-hosted')).toBe('subprocess')
    expect(backendToMethod('cloud')).toBe('ci')
  })
})

describe('importedJob', () => {
  it('derives a succeeded job with metrics + artifact ref from a Colab import', () => {
    const job = importedJob({
      jobId: 'job-abc',
      metadata: METADATA,
      provenance: USER_OWNED,
      metrics: { recall: 0.96, accuracy: 0.98 },
      classifierRef: 'user:model-1',
      importedAtMs: 2_000,
    })
    expect(job.status).toBe('succeeded')
    expect(job.id).toBe('job-abc')
    expect(job.phrase).toBe('hey studio')
    expect(job.moduleId).toBe('kws-openwakeword')
    expect(job.method).toBe('colab')
    expect(job.backend).toBe('colab')
    expect(job.startedAtMs).toBe(1_000) // trainedAtMs from the bundle
    expect(job.finishedAtMs).toBe(2_000)
    expect(job.artifactRef).toBe('user:model-1')
    expect(job.metrics).toEqual({ recall: 0.96, accuracy: 0.98 })
    expect(job.license).toBe('user-owned')
  })

  it('preserves a non-user-owned license (export gate input)', () => {
    const job = importedJob({
      jobId: 'job-x',
      metadata: METADATA,
      provenance: { license: 'CC BY-NC-SA 4.0' },
      classifierRef: 'user:m',
      importedAtMs: 2_000,
    })
    expect(job.license).toBe('CC BY-NC-SA 4.0')
  })

  it('auto-detects a tunnel URL the notebook wrote into the bundle params', () => {
    const job = importedJob({
      jobId: 'job-t',
      metadata: {
        ...METADATA,
        params: { wakePhrase: 'hey studio', tunnelUrl: 'https://abc.trycloudflare.com' },
      },
      provenance: USER_OWNED,
      classifierRef: 'user:m',
      importedAtMs: 2_000,
    })
    expect(job.tunnelUrl).toBe('https://abc.trycloudflare.com')
  })
})

describe('sortJobsNewestFirst / upsertJob', () => {
  const old: HistoryJob = {
    id: 'old',
    status: 'succeeded',
    phrase: 'one',
    params: {},
    moduleId: 'kws-openwakeword',
    method: 'colab',
    backend: 'colab',
    startedAtMs: 100,
  }
  const fresh: HistoryJob = {
    id: 'fresh',
    status: 'running',
    phrase: 'two',
    params: {},
    moduleId: 'rnnoise',
    method: 'ci',
    backend: 'self-hosted',
    startedAtMs: 200,
  }

  it('orders newest first', () => {
    expect(sortJobsNewestFirst([old, fresh]).map((j) => j.id)).toEqual(['fresh', 'old'])
  })

  it('does not mutate the input', () => {
    const input = [old, fresh]
    sortJobsNewestFirst(input)
    expect(input.map((j) => j.id)).toEqual(['old', 'fresh'])
  })

  it('upserts by id, keeping newest-first order', () => {
    const withFresh = upsertJob([old], fresh)
    expect(withFresh.map((j) => j.id)).toEqual(['fresh', 'old'])

    const updated = upsertJob(withFresh, { ...old, status: 'failed', startedAtMs: 300 })
    expect(updated).toHaveLength(2)
    expect(updated[0].id).toBe('old')
    expect(updated[0].status).toBe('failed')
  })
})

describe('deriveNews (train news feed)', () => {
  const base: HistoryJob = {
    id: 'j1',
    status: 'queued',
    phrase: 'hey studio',
    params: {},
    moduleId: 'kws-openwakeword',
    method: 'colab',
    backend: 'colab',
    startedAtMs: 100,
  }

  it('emits a started tip for queued/running jobs', () => {
    const items = deriveNews([base])
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('started')
    expect(items[0].message).toContain('hey studio')
    expect(items[0].message).toContain('kws-openwakeword')
  })

  it('emits an imported tip for succeeded jobs with an artifact', () => {
    const items = deriveNews([
      { ...base, status: 'succeeded', finishedAtMs: 200, artifactRef: 'user:m1' },
    ])
    expect(items[0].kind).toBe('imported')
    expect(items[0].message).toContain('imported')
    expect(items[0].atMs).toBe(200)
  })

  it('emits failed tips and orders newest first', () => {
    const failed: HistoryJob = {
      ...base,
      id: 'f1',
      status: 'failed',
      finishedAtMs: 500,
    }
    const ok: HistoryJob = {
      ...base,
      id: 's1',
      status: 'succeeded',
      finishedAtMs: 300,
      artifactRef: 'user:m',
    }
    const items = deriveNews([failed, ok])
    expect(items.map((i) => i.id)).toEqual(['f1:failed', 's1:succeeded'])
    expect(items[0].kind).toBe('failed')
  })
})