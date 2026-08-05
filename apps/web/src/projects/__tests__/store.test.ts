/**
 * Projects store tests.
 *
 * The store wraps IndexedDB. Vitest runs in Node (no indexedDB), so these
 * tests exercise the pure pieces and mock the IDB adapter through a minimal
 * in-memory shim. This keeps the store logic (ordering, round-trips) tested
 * without a browser; the browser path is covered by the e2e workspace flow.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { WakeWordProject } from '../types'
import { saveProject, listProjects, getProject, deleteProject, clearProjects } from '../store'

// ---------------------------------------------------------------------------
// Minimal in-memory IndexedDB shim (objectStore.put/get/getAll/delete/clear).
// ---------------------------------------------------------------------------

class MemoryObjectStore {
  private map = new Map<string, unknown>()

  /** IDBRequest-lookalike that fires onsuccess synchronously on attach. */
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
    // The store's openDb resolves on req.onsuccess. Fire it on the next tick
    // so the caller has attached the handler.
    queueMicrotask(() => req.onsuccess?.())
    return req
  },
}

let idbSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  stores.clear()
  ;(globalThis as Record<string, unknown>).indexedDB = fakeIndexedDB
  idbSpy = vi.fn()
})

afterEach(() => {
  delete (globalThis as Record<string, unknown>).indexedDB
})

function makeProject(partial: Partial<WakeWordProject> = {}): WakeWordProject {
  return {
    id: partial.id ?? `p-${Math.random().toString(36).slice(2)}`,
    name: partial.name ?? 'Test project',
    targetWord: partial.targetWord ?? 'hey studio',
    domain: 'high-performance',
    config: {
      afe: { topology: 'single-worklet', channels: 1, frameMs: { aec: 10, bss: 10, ns: 10 }, latencyBudgetMs: 150, vizFps: 30 },
      kws: { backend: 'openwakeword', threshold: 0.5, minDurationMs: 300, smoothingWindowFrames: 5, vadGateEnabled: true, vadThreshold: 0.3, cooldownMs: 2000, executionProvider: 'wasm' },
      fewShot: { threshold: 0.7, minDurationMs: 300, cooldownMs: 2000, smoothingWindowFrames: 5, vadGateEnabled: true, vadThreshold: 0.3, windowMs: 1500, hopMs: 80, useNegativePrototype: false },
    },
    sampleIds: [],
    prototypeIds: [],
    createdAtMs: 1,
    updatedAtMs: 1,
    ...partial,
  }
}

describe('projects store', () => {
  it('saves and round-trips a project', async () => {
    const p = makeProject({ id: 'a', name: 'My word' })
    await saveProject(p)
    const got = await getProject('a')
    expect(got).toBeDefined()
    expect(got!.name).toBe('My word')
    expect(got!.config.kws.backend).toBe('openwakeword')
    expect(idbSpy).toBeDefined()
  })

  it('lists projects most-recently-updated first', async () => {
    const a = makeProject({ id: 'a', updatedAtMs: 100 })
    const b = makeProject({ id: 'b', updatedAtMs: 200 })
    await saveProject(a)
    await saveProject(b)
    const list = await listProjects()
    expect(list.map((p) => p.id)).toEqual(['b', 'a'])
  })

  it('get returns undefined for unknown id', async () => {
    expect(await getProject('missing')).toBeUndefined()
  })

  it('delete removes a project', async () => {
    await saveProject(makeProject({ id: 'del' }))
    await deleteProject('del')
    expect(await getProject('del')).toBeUndefined()
  })

  it('clear empties the store', async () => {
    await saveProject(makeProject({ id: 'x' }))
    await clearProjects()
    expect(await listProjects()).toEqual([])
  })

  it('overwrites an existing project on save', async () => {
    await saveProject(makeProject({ id: 'a', name: 'v1' }))
    await saveProject(makeProject({ id: 'a', name: 'v2' }))
    const got = await getProject('a')
    expect(got!.name).toBe('v2')
  })
})
