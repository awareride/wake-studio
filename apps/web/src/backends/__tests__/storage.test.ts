/**
 * Managed-backends storage tests (Backends menu).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  loadBackends,
  removeBackend,
  saveBackends,
  upsertBackend,
} from '../storage'
import type { ManagedBackend } from '../types'

// Minimal in-memory localStorage shim (Vitest runs in Node).
function makeLocalStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => {
      map.delete(k)
    },
    setItem: (k: string, v: string) => {
      map.set(k, String(v))
    },
  } as Storage
}

const BACKEND: ManagedBackend = {
  id: 'b1',
  name: 'My server',
  baseUrl: 'http://127.0.0.1:4824',
  token: 'sekrit',
  kind: 'long-term',
  status: 'online',
  lastSeenMs: 1,
  createdAtMs: 1,
}

describe('backends storage', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', makeLocalStorage())
  })
  afterEach(() => vi.unstubAllGlobals())

  it('loads an empty list when nothing is stored', () => {
    expect(loadBackends()).toEqual([])
  })

  it('round-trips a saved list', () => {
    saveBackends([BACKEND])
    expect(loadBackends()).toEqual([BACKEND])
  })

  it('upserts: adds new, replaces existing by id', () => {
    let list = upsertBackend([], BACKEND)
    expect(list).toHaveLength(1)
    list = upsertBackend(list, { ...BACKEND, name: 'Renamed', status: 'offline' })
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('Renamed')
    expect(list[0].status).toBe('offline')
    expect(loadBackends()).toEqual(list) // persisted
  })

  it('removes by id and persists', () => {
    let list = upsertBackend([], BACKEND)
    list = removeBackend(list, 'b1')
    expect(list).toEqual([])
    expect(loadBackends()).toEqual([])
  })

  it('tolerates malformed localStorage (bad JSON / wrong shape)', () => {
    localStorage.setItem('wake-backends', '{not json')
    expect(loadBackends()).toEqual([])
    localStorage.setItem('wake-backends', JSON.stringify([{ nope: true }, BACKEND]))
    expect(loadBackends()).toEqual([BACKEND])
  })
})
