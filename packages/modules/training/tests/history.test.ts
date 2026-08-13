/**
 * L1 tests — training history model (issue #105).
 *
 * Derivation helpers for the history rail: run starts, Colab imports,
 * ordering, upserts. Pure logic, no UI. (The IndexedDB wrapper is tested via
 * an in-memory shim in history-store.test.ts.)
 */

import { describe, it, expect } from 'vitest'
import {
  startedJob,
  importedJob,
  sortJobsNewestFirst,
  upsertJob,
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
      id: 'local-1',
      backend: 'colab',
      params: { wakePhrase: 'hey studio', epochs: '50' },
      startedAtMs: 5_000,
    })
    expect(job.status).toBe('queued')
    expect(job.phrase).toBe('hey studio')
    expect(job.backend).toBe('colab')
    expect(job.params.epochs).toBe('50')
    expect(job.startedAtMs).toBe(5_000)
    expect(job.artifactRef).toBeUndefined()
  })

  it("falls back to now for startedAtMs and '' for a missing phrase", () => {
    const before = Date.now()
    const job = startedJob({ id: 'local-2', backend: 'self-hosted', params: {} })
    expect(job.startedAtMs).toBeGreaterThanOrEqual(before)
    expect(job.phrase).toBe('')
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
})

describe('sortJobsNewestFirst / upsertJob', () => {
  const old: HistoryJob = {
    id: 'old',
    status: 'succeeded',
    phrase: 'one',
    params: {},
    backend: 'colab',
    startedAtMs: 100,
  }
  const fresh: HistoryJob = {
    id: 'fresh',
    status: 'running',
    phrase: 'two',
    params: {},
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