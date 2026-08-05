/**
 * kws-plix driver module - L1 tests (ADR-026).
 *
 * Covers the PlixKwsBackend (buffering/scoring with a fake embedder) and the
 * PlixKwsEmbedProvider runtime selection (stubbed runtimes), plus the encoder
 * variant registry. ONNX/fetch paths are e2e-tested.
 */

import { describe, it, expect, vi } from 'vitest'
import { PlixKwsBackend } from '../core'
import {
  PLIX_ENCODER_VARIANTS,
  getPlixEncoderVariant,
  plixVariantOnnxUrl,
} from '../encoders/plix-encoder'
import type { WakeWordPrototype } from '../core/prototype'
import type { EmbedProvider } from '@wake-studio/module-kws-engine'

class FakeEmbedder implements EmbedProvider {
  ready = true
  async embed(): Promise<Float32Array> {
    return new Float32Array(1280).fill(0.5)
  }
}

const FAKE_PROTOTYPE: WakeWordPrototype = {
  id: 'p',
  word: 'test',
  vector: new Float32Array(1280).fill(0.5),
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

// ---------------------------------------------------------------------------
// PlixKwsEmbedProvider - runtime selection (ADR-002 global ModelRuntime)
// ---------------------------------------------------------------------------

vi.mock('../encoders/plix-onnx', () => ({
  PlixOnnxEncoder: class StubOnnxEncoder {
    runtime = 'onnx' as const
    ready = false
    async load() {
      this.ready = true
    }
    async embed() {
      return new Float32Array(1280).fill(0.1)
    }
    async dispose() {
      this.ready = false
    }
  },
}))
vi.mock('../encoders/plix-transformers', () => ({
  PlixTransformersEncoder: class StubTransformersEncoder {
    runtime = 'transformers' as const
    ready = false
    async load() {
      this.ready = true
    }
    async embed() {
      return new Float32Array(1280).fill(0.2)
    }
    async dispose() {
      this.ready = false
    }
  },
}))
vi.mock('../encoders/plix-executorch', () => ({
  PlixExecuTorchEncoder: class StubExecuTorchEncoder {
    runtime = 'executorch' as const
    ready = false
    async load() {
      this.ready = true
    }
    async embed() {
      throw new Error('PLiX (executorch) runtime is deferred')
    }
    async dispose() {
      this.ready = false
    }
  },
}))

const { PlixKwsEmbedProvider } = await import('../encoders/plixkws-embed')

describe('PlixKwsEmbedProvider runtime selection', () => {
  it('defaults to the onnx runtime when no hint is given', async () => {
    const provider = new PlixKwsEmbedProvider('/x.onnx' as never)
    expect(provider.ready).toBe(false)
    await provider.load('/x.onnx' as never, 'wasm')
    expect(provider.ready).toBe(true)
    const out = await provider.embed(new Float32Array(16000), 16000)
    expect(out[0]).toBeCloseTo(0.1, 5)
  })

  it('selects the transformers runtime when hinted', async () => {
    const provider = new PlixKwsEmbedProvider('aaqibsaeed/plixkws', 'transformers')
    await provider.load('aaqibsaeed/plixkws', 'wasm')
    expect(provider.ready).toBe(true)
    const out = await provider.embed(new Float32Array(16000), 16000)
    expect(out[0]).toBeCloseTo(0.2, 5)
  })

  it('throws if embed() is called before load()', async () => {
    const provider = new PlixKwsEmbedProvider('/x.onnx' as never)
    await expect(provider.embed(new Float32Array(16000), 16000)).rejects.toThrow(
      /not loaded/,
    )
  })

  it('selects the executorch runtime when hinted (deferred impl throws)', async () => {
    const provider = new PlixKwsEmbedProvider('/x.pte', 'executorch')
    await provider.load('/x.pte', 'wasm')
    expect(provider.ready).toBe(true)
    await expect(
      provider.embed(new Float32Array(16000), 16000),
    ).rejects.toThrow(/deferred/)
  })
})

// ---------------------------------------------------------------------------
// PLIX_ENCODER_VARIANTS (ADR-002)
// ---------------------------------------------------------------------------

describe('PLIX_ENCODER_VARIANTS', () => {
  it('exposes exactly the base and small variants', () => {
    expect(PLIX_ENCODER_VARIANTS.map((v) => v.id)).toEqual(['base', 'small'])
  })

  it('every variant has a label, onnx URL, and transformers local dir', () => {
    for (const v of PLIX_ENCODER_VARIANTS) {
      expect(v.label.length).toBeGreaterThan(0)
      expect(v.onnxUrl.startsWith('/modules/kws/plix/assets/')).toBe(true)
      expect(v.transformersLocalDir.startsWith('/modules/kws/plix/assets/')).toBe(
        true,
      )
      expect(v.note.length).toBeGreaterThan(0)
    }
  })

  it('base maps to plixkws-base.onnx and small to plixkws-small.onnx', () => {
    expect(plixVariantOnnxUrl('base')).toBe(
      '/modules/kws/plix/assets/plixkws-base.onnx',
    )
    expect(plixVariantOnnxUrl('small')).toBe(
      '/modules/kws/plix/assets/plixkws-small.onnx',
    )
  })

  it('getPlixEncoderVariant returns the descriptor and undefined for unknown', () => {
    expect(getPlixEncoderVariant('small')?.id).toBe('small')
    expect(getPlixEncoderVariant('base')?.id).toBe('base')
    // @ts-expect-error intentionally invalid id
    expect(getPlixEncoderVariant('tiny')).toBeUndefined()
  })
})
