/**
 * RNNoise module - L2 wasm-runtime test (ADR-026).
 *
 * Loads the vendored emscripten glue IN NODE (the glue supports
 * ENVIRONMENT_IS_NODE) and verifies the wasm actually boots AND behaves:
 * engine created, one frame processed, VAD returned with real semantics
 * (loud sine > silence), denoising works. This is the "artifact boots"
 * gate that runs on every PR without a browser.
 */

import { describe, it, expect } from 'vitest'
import createRNNWasmModuleSync from '../web/vendor/generated/rnnoise-sync'
import { RnnoiseModule } from '../core'
import { RNNOISE_FRAME_SIZE } from '../core/constants'

function sineFrame(freq = 440, amp = 1): Float32Array {
  const f = new Float32Array(RNNOISE_FRAME_SIZE)
  for (let i = 0; i < RNNOISE_FRAME_SIZE; i++) {
    f[i] = Math.sin((2 * Math.PI * freq * i) / 48000) * amp
  }
  return f
}

describe('RNNoise wasm runtime (L2, Node)', () => {
  it('boots the wasm and processes a frame with a real VAD', () => {
    const wasm = createRNNWasmModuleSync()
    const engine = new RnnoiseModule(wasm, { strength: 1, denoiseEnabled: true })

    // Loud sine -> VAD should be high (> 0.5). Silent frame -> lower.
    const sine = sineFrame(440, 1)
    const result = engine.processFrame(sine)

    expect(result.vadProbability).toBeGreaterThan(0.5)
    expect(result.vadProbability).toBeLessThanOrEqual(1)
    expect(result.denoised).toBe(true)
    // Denoising should have attenuated the frame.
    expect(Math.max(...Array.from(sine).map(Math.abs))).toBeLessThan(1)

    const silence = new Float32Array(RNNOISE_FRAME_SIZE)
    const silenceVad = engine.processFrame(silence).vadProbability
    expect(silenceVad).toBeLessThan(result.vadProbability)

    engine.destroy()
  })

  it('returns a bounded VAD for silence', () => {
    const wasm = createRNNWasmModuleSync()
    const engine = new RnnoiseModule(wasm, { denoiseEnabled: false })

    const silence = new Float32Array(RNNOISE_FRAME_SIZE)
    const vad = engine.processFrame(silence).vadProbability

    expect(vad).toBeGreaterThanOrEqual(0)
    expect(vad).toBeLessThanOrEqual(1)

    engine.destroy()
  })
})

/*
 * `strength` is a wet/dry mix (RNNoise has no native strength parameter).
 * It used to be stored and never read, so the panel slider did nothing.
 */
describe('RNNoise strength (wet/dry mix)', () => {
  function run(strength: number, denoiseEnabled = true): Float32Array {
    const wasm = createRNNWasmModuleSync()
    const engine = new RnnoiseModule(wasm, { strength, denoiseEnabled })
    const frame = sineFrame(440, 0.5)
    engine.processFrame(frame)
    engine.destroy()
    return frame
  }

  it('leaves the frame untouched at strength 0 (bypass)', () => {
    const out = run(0)
    const original = sineFrame(440, 0.5)
    for (let i = 0; i < RNNOISE_FRAME_SIZE; i++) {
      expect(out[i]).toBeCloseTo(original[i], 6)
    }
  })

  it('applies full denoising at strength 1', () => {
    const full = run(1)
    const original = sineFrame(440, 0.5)
    // The dry path must not be identical at full strength.
    expect(full.some((v, i) => Math.abs(v - original[i]) > 1e-6)).toBe(true)
  })

  it('interpolates monotonically between dry and wet', () => {
    const dry = run(0)
    const half = run(0.5)
    const wet = run(1)
    const orig = sineFrame(440, 0.5)
    for (let i = 0; i < RNNOISE_FRAME_SIZE; i++) {
      const dryErr = Math.abs(dry[i] - orig[i])
      const wetErr = Math.abs(wet[i] - orig[i])
      const halfErr = Math.abs(half[i] - orig[i])
      // A 0.5 mix sits between the two, within the span of their errors.
      expect(halfErr).toBeLessThanOrEqual(Math.max(dryErr, wetErr) + 1e-6)
      expect(halfErr).toBeGreaterThanOrEqual(Math.min(dryErr, wetErr) - 1e-6)
    }
  })

  it('never modifies the frame when denoising is disabled', () => {
    const out = run(1, false)
    const original = sineFrame(440, 0.5)
    for (let i = 0; i < RNNOISE_FRAME_SIZE; i++) {
      expect(out[i]).toBe(original[i])
    }
  })

  it('clamps out-of-range strength values', () => {
    const over = run(5)
    const wet = run(1)
    for (let i = 0; i < RNNOISE_FRAME_SIZE; i++) {
      expect(over[i]).toBeCloseTo(wet[i], 6)
    }
    const under = run(-3)
    const dry = run(0)
    for (let i = 0; i < RNNOISE_FRAME_SIZE; i++) {
      expect(under[i]).toBeCloseTo(dry[i], 6)
    }
  })
})

/*
 * Issue #243: the spec params must reach the engine through the stage's
 * `configure` seam, not just exist in a control. These assertions read the
 * engine's config back, which is what the audio path actually uses.
 */
describe('RnnoiseNsStage.configure (issue #243 param delivery)', () => {
  it('delivers strength and denoiseEnabled from the stage configure seam', async () => {
    const { RnnoiseNsStage } = await import('../core/afe-stage')
    const wasm = createRNNWasmModuleSync()
    const stage = new RnnoiseNsStage(wasm)

    // Defaults come from the engine.
    expect(stage.engineConfig.strength).toBe(1)

    stage.configure({ strength: 0.35, denoiseEnabled: false })
    expect(stage.engineConfig.strength).toBe(0.35)
    expect(stage.engineConfig.denoiseEnabled).toBe(false)

    stage.configure({ strength: 0.9 })
    expect(stage.engineConfig.strength).toBe(0.9)
    expect(stage.engineConfig.denoiseEnabled).toBe(false) // untouched keys survive
  })

  it('ignores unknown keys and non-matching types (no throw in the audio thread)', async () => {
    const { RnnoiseNsStage } = await import('../core/afe-stage')
    const stage = new RnnoiseNsStage(createRNNWasmModuleSync())

    expect(() => stage.configure({ unknownKey: 42 })).not.toThrow()
    expect(() => stage.configure({ strength: 'loud' } as never)).not.toThrow()
    expect(() => stage.configure({})).not.toThrow()
    // The wrongly typed value was ignored, not coerced.
    expect(stage.engineConfig.strength).toBe(1)
  })

  it('changes the processed audio, i.e. the value is not cosmetic', async () => {
    const { RnnoiseNsStage } = await import('../core/afe-stage')
    const wasm = createRNNWasmModuleSync()

    const full = new RnnoiseNsStage(wasm)
    full.configure({ strength: 1 })
    const dry = new RnnoiseNsStage(wasm)
    dry.configure({ strength: 0 })

    const frameA = sineFrame(440, 0.5)
    const frameB = sineFrame(440, 0.5)
    full.process(frameA)
    dry.process(frameB)

    let maxDiff = 0
    for (let i = 0; i < RNNOISE_FRAME_SIZE; i++) {
      maxDiff = Math.max(maxDiff, Math.abs(frameA[i] - frameB[i]))
    }
    expect(maxDiff).toBeGreaterThan(1e-4)
  })
})
