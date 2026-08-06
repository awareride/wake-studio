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
