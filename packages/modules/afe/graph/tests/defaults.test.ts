/**
 * AFE graph module - L1 unit tests (ADR-026).
 *
 * Tests the module's own pure logic (defaults, constants, parameter
 * descriptors). DSP numerics are NOT tested here - they live in
 * `@wake-studio/dsp` (conformance + behavior tests there, ADR-032).
 */

import { describe, it, expect } from 'vitest'
import {
  INTERNAL_SAMPLE_RATE,
  OUTPUT_SAMPLE_RATE,
  RNNOISE_FRAME_SIZE,
  QUANTUM_SIZE,
  DOWNSAMPLE_RATIO,
  CIRCULAR_BUFFER_SIZE,
  DEFAULT_CONFIG,
  describeParameters,
} from '../core/defaults'
import type { AFEConfig } from '../core/types'

describe('sample rates', () => {
  it('AFE runs at 48 kHz (RNNoise-native, ADR-016)', () => {
    expect(INTERNAL_SAMPLE_RATE).toBe(48000)
  })

  it('KWS output is 16 kHz (ADR-001)', () => {
    expect(OUTPUT_SAMPLE_RATE).toBe(16000)
  })

  it('downsample ratio is 3:1', () => {
    expect(DOWNSAMPLE_RATIO).toBe(3)
  })
})

describe('frame / buffer constants', () => {
  it('RNNoise frame is 480 samples (10 ms @ 48 kHz)', () => {
    expect(RNNOISE_FRAME_SIZE).toBe(480)
  })

  it('worklet quantum is 128 samples', () => {
    expect(QUANTUM_SIZE).toBe(128)
  })

  it('circular buffer is LCM(128, 480) = 1920', () => {
    // LCM(128, 480): 128 = 2^7, 480 = 2^5*3*5 -> 2^7*3*5 = 1920.
    expect(CIRCULAR_BUFFER_SIZE).toBe(1920)
    expect(CIRCULAR_BUFFER_SIZE % QUANTUM_SIZE).toBe(0)
    expect(CIRCULAR_BUFFER_SIZE % RNNOISE_FRAME_SIZE).toBe(0)
  })
})

describe('DEFAULT_CONFIG', () => {
  it('ships workable out-of-the-box defaults (ADR-017)', () => {
    const c: AFEConfig = DEFAULT_CONFIG
    expect(c.topology).toBe('single-worklet')
    expect(c.channels).toBeGreaterThanOrEqual(1)
    expect(c.frameMs.aec).toBeGreaterThan(0)
    expect(c.frameMs.bss).toBeGreaterThan(0)
    expect(c.frameMs.ns).toBeGreaterThan(0)
    expect(c.latencyBudgetMs).toBeGreaterThan(0)
    expect(c.vizFps).toBeGreaterThan(0)
  })
})

describe('describeParameters', () => {
  it('exposes unique parameter descriptors (ADR-017)', () => {
    const params = describeParameters()
    expect(params.length).toBeGreaterThan(0)
    const ids = params.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const p of params) {
      expect(p.label).toBeTruthy()
      expect(p.default).not.toBeUndefined()
    }
  })
})
