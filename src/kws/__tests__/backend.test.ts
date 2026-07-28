import { describe, it, expect } from 'vitest'
import {
  BACKEND_REGISTRY,
  createBackend,
  getBackendRegistration,
} from '../backend'
import { OpenWakeWordBackend } from '../backends/openwakeword'
import type { KWSBackendId } from '../types'

// ---------------------------------------------------------------------------
// BACKEND_REGISTRY
// ---------------------------------------------------------------------------

describe('BACKEND_REGISTRY', () => {
  it('lists all four ADR-020 backends', () => {
    const ids = BACKEND_REGISTRY.map((r) => r.id)
    expect(ids).toEqual([
      'openwakeword',
      'microwakeword',
      'wavlm-few-shot',
      'pocketsphinx',
    ])
  })

  it('openwakeword and wavlm-few-shot are browser-feasible', () => {
    const feasible = BACKEND_REGISTRY.filter((r) => r.browserFeasible)
    expect(feasible.map((r) => r.id)).toEqual(['openwakeword', 'wavlm-few-shot'])
  })

  it('every entry has a label and an availability note', () => {
    for (const r of BACKEND_REGISTRY) {
      expect(r.label.length).toBeGreaterThan(0)
      expect(r.availabilityNote.length).toBeGreaterThan(0)
    }
  })
})

// ---------------------------------------------------------------------------
// getBackendRegistration
// ---------------------------------------------------------------------------

describe('getBackendRegistration', () => {
  it('returns the entry for a known id', () => {
    const reg = getBackendRegistration('openwakeword')
    expect(reg).toBeDefined()
    expect(reg!.id).toBe('openwakeword')
  })

  it('returns undefined for an unknown id (type-safe guard)', () => {
    // The function is typed to KWSBackendId, but guard the runtime path.
    expect(getBackendRegistration('unknown' as KWSBackendId)).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// createBackend
// ---------------------------------------------------------------------------

describe('createBackend', () => {
  it('creates an OpenWakeWordBackend for openwakeword', () => {
    const backend = createBackend('openwakeword')
    expect(backend).toBeInstanceOf(OpenWakeWordBackend)
    expect(backend.id).toBe('openwakeword')
    expect(backend.label.length).toBeGreaterThan(0)
  })

  it('throws for microwakeword (MCU / export-only)', () => {
    expect(() => createBackend('microwakeword')).toThrow(/not browser-feasible/)
  })

  it('throws for wavlm-few-shot (created by the worker, not the factory)', () => {
    expect(() => createBackend('wavlm-few-shot')).toThrow(/created directly by the worker/)
  })

  it('throws for pocketsphinx (pending WASM port)', () => {
    expect(() => createBackend('pocketsphinx')).toThrow(/not yet implemented/)
  })

  it('throws for an unknown id', () => {
    expect(() => createBackend('unknown' as KWSBackendId)).toThrow(/Unknown KWS backend/)
  })
})

// ---------------------------------------------------------------------------
// OpenWakeWordBackend (shape only; ONNX/fetch are e2e-tested)
// ---------------------------------------------------------------------------

describe('OpenWakeWordBackend', () => {
  it('is not ready before load', () => {
    const backend = new OpenWakeWordBackend()
    expect(backend.ready).toBe(false)
  })

  it('processFrame returns null before load (warmup / not-ready)', async () => {
    const backend = new OpenWakeWordBackend()
    const score = await backend.processFrame(new Float32Array(160))
    expect(score).toBeNull()
  })

  it('load() rejects when required URLs are missing', async () => {
    const backend = new OpenWakeWordBackend()
    await expect(backend.load({}, 'wasm')).rejects.toThrow(
      /requires melspectrogram, embedding, and classifier/,
    )
  })

  it('reset() and dispose() do not throw when unloaded', async () => {
    const backend = new OpenWakeWordBackend()
    expect(() => backend.reset()).not.toThrow()
    await expect(backend.dispose()).resolves.toBeUndefined()
    expect(backend.ready).toBe(false)
  })
})
