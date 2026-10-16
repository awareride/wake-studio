/**
 * Capture qualification cache tests (issue #246).
 *
 * The cache is what lets the source panel say something honest about a device
 * *before* Start, so these tests cover the two ways it can mislead: serving a
 * corrupt entry as if it were a verdict, and silently dropping a fresh one
 * (which would make the UI claim "not measured" forever).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  clearCachedQualification,
  qualificationSignature,
  readCachedQualification,
  writeCachedQualification,
} from '../qualificationCache'
import type { QualificationResult } from '@wake-studio/module-afe-graph'

/** Minimal in-memory localStorage (node has none). */
class MemoryStorage {
  private map = new Map<string, string>()
  get length(): number {
    return this.map.size
  }
  key(i: number): string | null {
    return Array.from(this.map.keys())[i] ?? null
  }
  getItem(k: string): string | null {
    return this.map.get(k) ?? null
  }
  setItem(k: string, v: string): void {
    this.map.set(k, String(v))
  }
  removeItem(k: string): void {
    this.map.delete(k)
  }
  clear(): void {
    this.map.clear()
  }
}

const RESULT: QualificationResult = {
  level: 'unsupported',
  spatialSupported: false,
  reasons: ['Channels carry the same signal (correlation 1.0000).'],
}

beforeEach(() => {
  ;(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage()
})

afterEach(() => {
  delete (globalThis as unknown as { localStorage?: MemoryStorage }).localStorage
})

describe('qualificationSignature', () => {
  it('separates devices and channel counts (the only things that change the answer)', () => {
    expect(qualificationSignature({ deviceId: 'a', channelCount: 2 })).not.toBe(
      qualificationSignature({ deviceId: 'b', channelCount: 2 }),
    )
    expect(qualificationSignature({ deviceId: 'a', channelCount: 2 })).not.toBe(
      qualificationSignature({ deviceId: 'a', channelCount: 1 }),
    )
  })

  it('treats an unset device as the default device', () => {
    expect(qualificationSignature({ channelCount: 2 })).toBe(
      qualificationSignature({ deviceId: 'default', channelCount: 2 }),
    )
  })
})

describe('read/write round trip', () => {
  it('remembers a verdict for its capture', () => {
    writeCachedQualification({ deviceId: 'mic-1', channelCount: 2 }, RESULT)
    const back = readCachedQualification({ deviceId: 'mic-1', channelCount: 2 })
    expect(back).not.toBeNull()
    expect(back!.level).toBe('unsupported')
    expect(back!.reasons).toEqual(RESULT.reasons)
    expect(back!.deviceId).toBe('mic-1')
  })

  it('does not leak one capture signature into another', () => {
    writeCachedQualification({ deviceId: 'mic-1', channelCount: 2 }, RESULT)
    expect(readCachedQualification({ deviceId: 'mic-2', channelCount: 2 })).toBeNull()
    expect(readCachedQualification({ deviceId: 'mic-1', channelCount: 1 })).toBeNull()
  })

  it('ignores a corrupt entry rather than showing a bogus verdict', () => {
    localStorage.setItem('wake-studio:afe-qualification:default:ch1', '{not json')
    expect(readCachedQualification({ channelCount: 1 })).toBeNull()
    localStorage.setItem(
      'wake-studio:afe-qualification:default:ch1',
      JSON.stringify({ level: 'wonderful', reasons: [] }),
    )
    expect(readCachedQualification({ channelCount: 1 })).toBeNull()
  })

  it('clears every cached verdict', () => {
    writeCachedQualification({ deviceId: 'a', channelCount: 1 }, RESULT)
    writeCachedQualification({ deviceId: 'b', channelCount: 2 }, RESULT)
    clearCachedQualification()
    expect(readCachedQualification({ deviceId: 'a', channelCount: 1 })).toBeNull()
    expect(readCachedQualification({ deviceId: 'b', channelCount: 2 })).toBeNull()
  })
})

describe('without storage', () => {
  it('degrades to no cache instead of throwing', () => {
    delete (globalThis as unknown as { localStorage?: MemoryStorage }).localStorage
    expect(() => writeCachedQualification({ channelCount: 2 }, RESULT)).not.toThrow()
    expect(readCachedQualification({ channelCount: 2 })).toBeNull()
    expect(() => clearCachedQualification()).not.toThrow()
  })
})
