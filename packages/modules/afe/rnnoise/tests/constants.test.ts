/**
 * RNNoise module - L1 unit tests (ADR-026). Domain constants + VAD mapping +
 * re-exported dsp helpers, no wasm dependency.
 */

import { describe, it, expect } from 'vitest'
import {
  RNNOISE_FRAME_SIZE,
  vadToProbability,
  frameRms,
  applyGain,
} from '../core/constants'

describe('RNNOISE_FRAME_SIZE', () => {
  it('is 480 samples (10 ms at 48 kHz)', () => {
    expect(RNNOISE_FRAME_SIZE).toBe(480)
  })
})

describe('vadToProbability', () => {
  it('clamps to [0,1]', () => {
    expect(vadToProbability(-1)).toBe(0)
    expect(vadToProbability(0.5)).toBe(0.5)
    expect(vadToProbability(2)).toBe(1)
  })
})

describe('frameRms', () => {
  it('computes RMS of a constant frame', () => {
    const f = new Float32Array(480).fill(0.5)
    expect(frameRms(f)).toBeCloseTo(0.5, 5)
  })

  it('is 0 for silence', () => {
    expect(frameRms(new Float32Array(480))).toBe(0)
  })
})

describe('applyGain', () => {
  it('scales samples in place', () => {
    const f = new Float32Array([0.1, 0.2, 0.3])
    applyGain(f, 2)
    expect(f[0]).toBeCloseTo(0.2, 5)
    expect(f[1]).toBeCloseTo(0.4, 5)
    expect(f[2]).toBeCloseTo(0.6, 5)
  })
})
