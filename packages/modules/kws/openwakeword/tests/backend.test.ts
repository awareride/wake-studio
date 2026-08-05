/**
 * kws-openwakeword driver module - L1 tests (ADR-026).
 */

import { describe, it, expect } from 'vitest'
import { OpenWakeWordBackend } from '../core'
import { registerKwsBackend, getBackendRegistry } from '@wake-studio/module-kws-engine'

describe('OpenWakeWordBackend', () => {
  it('is not ready before load', () => {
    const b = new OpenWakeWordBackend()
    expect(b.ready).toBe(false)
    expect(b.id).toBe('openwakeword')
  })

  it('processFrame returns null before load (warmup / not-ready)', async () => {
    const b = new OpenWakeWordBackend()
    expect(await b.processFrame(new Float32Array(160))).toBeNull()
  })

  it('load() rejects when required URLs are missing', async () => {
    const b = new OpenWakeWordBackend()
    await expect(b.load({} as never, 'wasm')).rejects.toThrow()
  })

  it('reset() and dispose() do not throw when unloaded', async () => {
    const b = new OpenWakeWordBackend()
    b.reset()
    await b.dispose()
  })
})

describe('registration (ADR-024 decoupling)', () => {
  it('registers openwakeword into the engine registry', () => {
    // Importing the driver core (above) runs the side-effect registration.
    const ids = getBackendRegistry().map((r) => r.id)
    expect(ids).toContain('openwakeword')
  })

  it('the registered factory returns a working backend', () => {
    const entry = getBackendRegistry().find((r) => r.id === 'openwakeword')
    expect(entry?.browserFeasible).toBe(true)
    expect(entry?.create().id).toBe('openwakeword')
  })
})
