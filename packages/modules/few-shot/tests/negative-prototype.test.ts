/**
 * Few-Shot engine - negative-prototype enrollment tests (issue #69).
 *
 * Guards the open-set rejection plumbing: buildNegativeVector mean-pools
 * non-target sample embeddings, and attachNegativePrototype persists the
 * negative class onto the wake-word prototype (storage round-trips
 * negativeVector via the existing serialize/deserialize path).
 */

import { describe, it, expect, vi } from 'vitest'
import { FewShotEngine } from '../core/FewShotEngine'
import type { EnrolledSample, WakeWordPrototype } from '../core/types'

// attachNegativePrototype persists via IndexedDB (storage.ts). Node's vitest
// env has no indexedDB - stub a minimal in-memory store so the persistence
// round-trip is exercised.
function stubIndexedDb(): void {
  const store = new Map<string, unknown>()
  const fakeDb = {
    transaction: (_s: string, _mode: string) => {
      const tx = {
        objectStore: () => ({
          put: (v: unknown) => {
            store.set((v as { id: string }).id, v)
            return { onsuccess: null, onerror: null }
          },
          getAll: () => ({ onsuccess: null, onerror: null }),
          delete: () => ({ onsuccess: null, onerror: null }),
        }),
        oncomplete: null as null | (() => void),
        onerror: null,
      }
      // Fire the completion callback synchronously so the storage promise
      // resolves (the real IDB fires it after the write commits).
      queueMicrotask(() => tx.oncomplete?.())
      return tx
    },
    objectStoreNames: { contains: () => true },
    createObjectStore: () => ({}),
    close: () => {},
  }
  ;(globalThis as Record<string, unknown>).indexedDB = {
    open: () => {
      const req = {
        result: fakeDb,
        onupgradeneeded: null as null | (() => void),
        onsuccess: null as null | (() => void),
        onerror: null,
      }
      queueMicrotask(() => req.onsuccess?.())
      return req
    },
  }
}

stubIndexedDb()

/** Stub KWSEngine - the engine is only used for embed()/load(). */
const kwsStub = {
  embed: vi.fn(),
  load: vi.fn(),
  ready: false,
  setConfig: vi.fn(),
} as unknown as ConstructorParameters<typeof FewShotEngine>[0]

function sample(vec: number[]): EnrolledSample {
  return {
    id: `s-${vec.join('-')}`,
    samples: new Float32Array(0),
    sampleRate: 16000,
    embedding: new Float32Array(vec),
    quality: {
      peakDbfs: -12,
      snrDb: 28,
      durationMs: 1500,
      clipped: false,
      acceptable: true,
    },
    recordedAtMs: 0,
  }
}

describe('FewShotEngine negative prototype (issue #69)', () => {
  it('buildNegativeVector mean-pools non-target embeddings', () => {
    const fs = new FewShotEngine(kwsStub)
    const v = fs.buildNegativeVector([sample([1, 2, 3]), sample([3, 4, 5])])
    expect(Array.from(v)).toEqual([2, 3, 4])
  })

  it('buildNegativeVector throws on zero samples', () => {
    const fs = new FewShotEngine(kwsStub)
    expect(() => fs.buildNegativeVector([])).toThrow(/zero samples/)
  })

  it('attachNegativePrototype persists negativeVector onto the prototype', async () => {
    const fs = new FewShotEngine(kwsStub)
    const proto: WakeWordPrototype = {
      id: 'p1',
      word: 'hey job',
      vector: new Float32Array([1, 1, 1]),
      sampleIds: ['a'],
      createdAtMs: 1,
    }
    const updated = await fs.attachNegativePrototype(proto, new Float32Array([9, 9, 9]))

    expect(updated.negativeVector).toBeDefined()
    expect(Array.from(updated.negativeVector!)).toEqual([9, 9, 9])
    expect(updated.word).toBe('hey job')
    expect(updated.id).toBe('p1')
    // The original prototype object is not mutated.
    expect(proto.negativeVector).toBeUndefined()
  })
})
