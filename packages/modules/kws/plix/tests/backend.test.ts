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
  /** Value returned for every window; tests override this for scale checks. */
  value = new Float32Array(1280).fill(0.5)
  async embed(): Promise<Float32Array> {
    return this.value
  }
}

const FAKE_PROTOTYPE: WakeWordPrototype = {
  id: 'p',
  word: 'test',
  vector: new Float32Array(1280).fill(0.5),
  sampleIds: [],
  createdAtMs: 0,
}

/** A 10 ms AFE frame with energy above the silence floor (RMS ~= -13 dBFS). */
function speechFrame(seed = 0): Float32Array {
  const f = new Float32Array(160)
  for (let i = 0; i < 160; i++) {
    // ~0.2 amplitude sine -> RMS ~ -13 dBFS, well above the -45 floor.
    f[i] = 0.2 * Math.sin((2 * Math.PI * 200 * i) / 16000 + seed)
  }
  return f
}

/** A silent frame (all zeros) - must score 0 via the silence gate. */
function silentFrame(): Float32Array {
  return new Float32Array(160)
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
      const s = await backend.processFrame(speechFrame(i))
      if (s !== null) last = s
    }
    expect(last).not.toBeNull()
    expect(last!).toBeCloseTo(1.0, 3)
  })

  it('scores high for cosine-similar embeddings with large raw magnitude (issue #66)', async () => {
    // The PLiX encoder emits raw GAP embeddings with L2 norm ~4-5. Before the
    // fix, a near-perfect match (cosine 0.92) had raw d^2 ~3-4 -> score ~0.24,
    // unreachable for any threshold. After L2 normalization, the same vectors
    // score ~0.86 (d^2 = 2(1-cos)).
    const seed = new Float32Array(1280)
    for (let i = 0; i < 1280; i++) seed[i] = 0.5 + (i % 7) * 0.01
    const scale = 4.3 // raw L2 norm of the small encoder's embeddings
    const proto = new Float32Array(1280)
    for (let i = 0; i < 1280; i++) proto[i] = seed[i] * scale
    // Query = prototype + tiny perturbation, then scaled to the same magnitude
    const query = new Float32Array(1280)
    for (let i = 0; i < 1280; i++) query[i] = (seed[i] + 0.003 * ((i % 3) - 1)) * scale

    const cosine = (() => {
      let dot = 0, na = 0, nb = 0
      for (let i = 0; i < 1280; i++) {
        dot += query[i] * proto[i]
        na += query[i] * query[i]
        nb += proto[i] * proto[i]
      }
      return dot / (Math.sqrt(na) * Math.sqrt(nb))
    })()
    // Sanity: the fixtures are genuinely cosine-similar but far from identical.
    expect(cosine).toBeGreaterThan(0.9)

    const embedder = new FakeEmbedder()
    embedder.value = query
    const backend = new PlixKwsBackend(embedder, { ...FAKE_PROTOTYPE, vector: proto }, 1500)
    let last: number | null = null
    for (let i = 0; i < 200; i++) {
      const s = await backend.processFrame(speechFrame(i))
      if (s !== null) last = s
    }
    expect(last).not.toBeNull()
    // 1/(1+2(1-cos)) for cosine 0.92 is ~0.86; the pre-fix raw score was ~0.24.
    expect(last!).toBeGreaterThan(0.7)
  })

  it('reset() and dispose() do not throw when unloaded', async () => {
    const backend = new PlixKwsBackend(new FakeEmbedder(), FAKE_PROTOTYPE)
    expect(() => backend.reset()).not.toThrow()
    await expect(backend.dispose()).resolves.toBeUndefined()
  })

  it('scores 0 for silent windows (no false trigger on silence, issue)', async () => {
    // The PLiX model maps silence to a spot near the prototype in cosine
    // space (score ~0.74 after #66 normalization), so an energy floor is
    // required. With a fully silent window the backend must score 0 and skip
    // the encoder entirely.
    let embedCalls = 0
    const embedder = new FakeEmbedder()
    const originalEmbed = embedder.embed.bind(embedder)
    embedder.embed = async () => {
      embedCalls++
      return originalEmbed()
    }
    const backend = new PlixKwsBackend(embedder, FAKE_PROTOTYPE, 1500)
    let last: number | null = null
    for (let i = 0; i < 200; i++) {
      const s = await backend.processFrame(silentFrame())
      if (s !== null) last = s
    }
    expect(last).toBe(0)
    // The encoder must not run for silent windows.
    expect(embedCalls).toBe(0)
  })

  it('still scores normally for speech windows (silence gate does not clip speech)', async () => {
    const embedder = new FakeEmbedder()
    const backend = new PlixKwsBackend(embedder, FAKE_PROTOTYPE, 1500)
    let last: number | null = null
    for (let i = 0; i < 200; i++) {
      const s = await backend.processFrame(speechFrame(i))
      if (s !== null) last = s
    }
    expect(last).not.toBeNull()
    expect(last!).toBeCloseTo(1.0, 3)
  })

  it('negative prototype: word-like query scores high, other-speech-like query low (issue #69)', async () => {
    // Query close to the word prototype -> high P(word); query close to the
    // negative prototype -> low. With softmax over the two class distances:
    //   score = 1 / (1 + exp(d2_word - d2_neg))
    const wordVec = new Float32Array(1280).fill(0.5)
    const negVec = new Float32Array(1280).fill(-0.5)
    const proto: WakeWordPrototype = {
      id: 'p',
      word: 'hey job',
      vector: wordVec,
      negativeVector: negVec,
      sampleIds: [],
      createdAtMs: 0,
    }

    // Embedder returns a word-like query (same direction as wordVec).
    const wordEmbed = new Float32Array(1280).fill(0.5)
    const wordBackend = new PlixKwsBackend(
      new FakeEmbedder(),
      proto,
      1500,
      true, // useNegative
    )
    ;(wordBackend as unknown as { _embedProvider: { value: Float32Array } })._embedProvider.value =
      wordEmbed
    let wordScore: number | null = null
    for (let i = 0; i < 200; i++) {
      const s = await wordBackend.processFrame(speechFrame(i))
      if (s !== null) wordScore = s
    }
    expect(wordScore).not.toBeNull()
    expect(wordScore!).toBeGreaterThan(0.7)

    // Embedder returns an other-speech-like query (same direction as negVec).
    const negEmbed = new Float32Array(1280).fill(-0.5)
    const negBackend = new PlixKwsBackend(
      new FakeEmbedder(),
      proto,
      1500,
      true, // useNegative
    )
    ;(negBackend as unknown as { _embedProvider: { value: Float32Array } })._embedProvider.value =
      negEmbed
    let negScore: number | null = null
    for (let i = 0; i < 200; i++) {
      const s = await negBackend.processFrame(speechFrame(i))
      if (s !== null) negScore = s
    }
    expect(negScore).not.toBeNull()
    expect(negScore!).toBeLessThan(0.3)
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
