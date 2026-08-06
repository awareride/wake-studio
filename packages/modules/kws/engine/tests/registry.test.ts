/**
 * kws-engine module - L1 registry tests (ADR-026).
 *
 * The registry is a seam: drivers register into it. This test exercises the
 * registry contract without any driver module imported, so it runs standalone
 * in CI (ADR-024: adding a driver never edits the engine).
 */

import { describe, it, expect } from 'vitest'
import {
  getBackendRegistry,
  getBackendRegistration,
  createBackend,
  createMainThreadBackend,
  registerKwsBackend,
} from '../core/backend'
import type { KWSBackend } from '../core/types'

describe('KWS backend registry (engine seam)', () => {
  it('starts empty (drivers register on import)', () => {
    expect(getBackendRegistry()).toEqual([])
  })

  it('accepts a registration via registerKwsBackend', () => {
    const stub: KWSBackend = {
      id: 'openwakeword',
      label: 'test',
      ready: false,
      load: async () => {},
      processFrame: async () => null,
      reset: () => {},
      dispose: async () => {},
    }
    registerKwsBackend({
      id: 'openwakeword',
      label: 'test',
      category: 'traditional',
      create: () => stub,
      browserFeasible: true,
      availabilityNote: 'test',
    })
    expect(getBackendRegistration('openwakeword')?.create()).toBe(stub)
    expect(createBackend('openwakeword')).toBe(stub)
  })

  it('returns undefined for an unknown id', () => {
    expect(getBackendRegistration('pocketsphinx' as never)).toBeUndefined()
  })

  it('createBackend throws for unknown id', () => {
    expect(() => createBackend('pocketsphinx' as never)).toThrow('Unknown')
  })

  it('registerKwsBackend is idempotent (no duplicate registrations)', () => {
    const before = getBackendRegistry().length
    registerKwsBackend({
      id: 'openwakeword',
      label: 'dup',
      category: 'traditional',
      create: () => null as unknown as KWSBackend,
      browserFeasible: false,
      availabilityNote: '',
    })
    expect(getBackendRegistry().length).toBe(before)
  })

  it('createMainThreadBackend returns null without a mainThreadFactory', () => {
    expect(createMainThreadBackend('openwakeword')).toBeNull()
  })
})
