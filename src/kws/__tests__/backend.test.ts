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
      'plixkws',
      'pocketsphinx',
    ])
  })

  it('openwakeword and plixkws are browser-feasible', () => {
    const feasible = BACKEND_REGISTRY.filter((r) => r.browserFeasible)
    expect(feasible.map((r) => r.id)).toEqual(['openwakeword', 'plixkws'])
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

  it('throws for plixkws (created by the worker, not the factory)', () => {
    expect(() => createBackend('plixkws')).toThrow(/created directly by the worker/)
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

// ---------------------------------------------------------------------------
// PlixKwsBackend (shape only; ONNX/fetch are e2e-tested)
// ---------------------------------------------------------------------------

import { PlixKwsBackend } from '../backends/plixkws'
import type { EmbedProvider, WakeWordPrototype } from '../../few-shot/types'

// A minimal fake embedder that returns a fixed 1280-dim vector, so we can test
// the backend's buffering / scoring without loading an ONNX model.
class FakeEmbedder implements EmbedProvider {
  ready = true
  async embed(): Promise<Float32Array> {
    return new Float32Array(1280).fill(0.5)
  }
}

const FAKE_PROTOTYPE: WakeWordPrototype = {
  id: 'p',
  word: 'test',
  vector: new Float32Array(1280).fill(0.5), // identical -> score 1.0
  sampleIds: [],
  createdAtMs: 0,
}

describe('PlixKwsBackend', () => {
  it('is not ready before the embedder is ready', () => {
    const notReady = new FakeEmbedder()
    notReady.ready = false
    const backend = new PlixKwsBackend(notReady, FAKE_PROTOTYPE)
    expect(backend.ready).toBe(false)
  })

  it('processFrame returns null before a full window is buffered (warmup)', async () => {
    const backend = new PlixKwsBackend(new FakeEmbedder(), FAKE_PROTOTYPE, 1500)
    const score = await backend.processFrame(new Float32Array(160))
    expect(score).toBeNull()
  })

  it('scores 1.0 for an embedding identical to the prototype', async () => {
    const backend = new PlixKwsBackend(new FakeEmbedder(), FAKE_PROTOTYPE, 1500)
    // Feed enough 160-sample frames that a hop boundary (every 8 frames) lands
    // after a full ~1.5 s window has buffered (24000 samples).
    let last: number | null = null
    for (let i = 0; i < 200; i++) {
      const s = await backend.processFrame(new Float32Array(160))
      if (s !== null) last = s
    }
    expect(last).not.toBeNull()
    expect(last!).toBeCloseTo(1.0, 3)
  })

  it('reset() and dispose() do not throw when unloaded', async () => {
    const backend = new PlixKwsBackend(new FakeEmbedder(), FAKE_PROTOTYPE)
    expect(() => backend.reset()).not.toThrow()
    await expect(backend.dispose()).resolves.toBeUndefined()
  })
})
