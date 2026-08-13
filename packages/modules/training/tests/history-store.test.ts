/**
 * L1 tests — training history IndexedDB store (issue #105).
 *
 * Vitest runs in Node (no indexedDB), so the store is exercised against a
 * minimal in-memory shim (same pattern as the projects store tests). Covers
 * round-trips, status updates, and clearing.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { listJobs, saveJob, getJob, updateJobStatus, clearJobs, deleteJob } from '../core/history-store'
import type { HistoryJob } from '../core/history'

class MemoryObjectStore {
  private map = new Map<string, unknown>()

  private req<T>(result: T) {
    let onsuccess: (() => void) | null = null
    const r = {
      get result() {
        return result
      },
      set onsuccess(cb: (() => void) | null) {
        onsuccess = cb
        cb?.()
      },
      get onsuccess() {
        return onsuccess
      },
      onerror: null as (() => void) | null,
    }
    return r
  }

  put(v: { id: string }) {
    this.map.set(v.id, v)
    return this.req(undefined)
  }
  get(id: string) {
    return this.req(this.map.get(id))
  }
  getAll() {
    return this.req([...this.map.values()])
  }
  delete(id: string) {
    this.map.delete(id)
    return this.req(undefined)
  }
  clear() {
    this.map.clear()
    return this.req(undefined)
  }
}

const stores = new Map<string, MemoryObjectStore>()

const fakeIndexedDB = {
  open() {
    const req = {
      result: {
        transaction() {
          return {
            objectStore(storeName: string) {
              if (!stores.has(storeName)) stores.set(storeName, new MemoryObjectStore())
              return stores.get(storeName)!
            },
          }
        },
      },
      onupgradeneeded: null,
      onsuccess: null as (() => void) | null,
      onerror: null,
    }
    queueMicrotask(() => req.onsuccess?.())
    return req
  },
}

beforeEach(() => {
  stores.clear()
  ;(globalThis as Record<string, unknown>).indexedDB = fakeIndexedDB
})

afterEach(() => {
  delete (globalThis as Record<string, unknown>).indexedDB
})

function makeJob(partial: Partial<HistoryJob> = {}): HistoryJob {
  return {
    id: partial.id ?? `job-${Math.random().toString(36).slice(2)}`,
    status: partial.status ?? 'queued',
    phrase: partial.phrase ?? 'hey studio',
    params: partial.params ?? {},
    moduleId: partial.moduleId ?? 'kws-openwakeword',
    method: partial.method ?? 'colab',
    backend: partial.backend ?? 'colab',
    startedAtMs: partial.startedAtMs ?? Date.now(),
    ...partial,
  }
}

describe('training history store', () => {
  it('round-trips jobs', async () => {
    const job = makeJob({ id: 'a', phrase: 'jarvis' })
    await saveJob(job)
    expect(await getJob('a')).toMatchObject({ id: 'a', phrase: 'jarvis' })
    expect((await listJobs()).map((j) => j.id)).toEqual(['a'])
  })

  it('upserts by id (same key, updated payload)', async () => {
    await saveJob(makeJob({ id: 'a', status: 'queued' }))
    await saveJob(makeJob({ id: 'a', status: 'succeeded', license: 'user-owned' }))
    const jobs = await listJobs()
    expect(jobs).toHaveLength(1)
    expect(jobs[0].status).toBe('succeeded')
  })

  it('updates a job status and records finishedAtMs', async () => {
    await saveJob(makeJob({ id: 'a', status: 'running' }))
    await updateJobStatus('a', 'failed', 9_999)
    const job = await getJob('a')
    expect(job?.status).toBe('failed')
    expect(job?.finishedAtMs).toBe(9_999)
  })

  it("ignores status updates for unknown ids", async () => {
    await updateJobStatus('nope', 'failed')
    expect(await listJobs()).toHaveLength(0)
  })

  it('clears everything', async () => {
    await saveJob(makeJob({ id: 'a' }))
    await saveJob(makeJob({ id: 'b' }))
    await clearJobs()
    expect(await listJobs()).toHaveLength(0)
  })

  it('deletes a single job', async () => {
    await saveJob(makeJob({ id: 'a' }))
    await saveJob(makeJob({ id: 'b' }))
    await deleteJob('a')
    expect(await listJobs()).toHaveLength(1)
    expect((await getJob('a'))).toBeUndefined()
  })

  it('is a no-op for unknown ids', async () => {
    await saveJob(makeJob({ id: 'a' }))
    await deleteJob('nope')
    expect(await listJobs()).toHaveLength(1)
  })
})