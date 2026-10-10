/**
 * AFE module - capture / array qualification (issue #246).
 *
 * These tests encode the three capture shapes the acceptance criteria name:
 * a genuine 2-channel input, an OS downmix (two identical channels), and a
 * duplicated channel. The disqualifying signature in the latter two is the
 * same — identical channels — which is exactly why "the track says 2 channels"
 * proves nothing.
 */

import { describe, it, expect } from 'vitest'
import {
  ChannelProbe,
  DUPLICATE_CORRELATION,
  ENERGY_IMBALANCE_RATIO,
  MIN_OBSERVATION_FRAMES,
  evaluateQualification,
  type CaptureReport,
} from '../core/qualify'

const RATE = 48000

function report(over: Partial<CaptureReport> = {}): CaptureReport {
  return {
    requestedChannels: 2,
    observedChannels: 2,
    sampleRate: RATE,
    framesObserved: 40,
    maxPairCorrelation: 0.05,
    clipped: false,
    energyRatio: 0.9,
    ...over,
  }
}

/** Deterministic pseudo-random source (no Math.random in tests). */
function noise(seed: number, n: number): Float32Array {
  const out = new Float32Array(n)
  let x = seed | 0
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff
    out[i] = (x / 0x7fffffff) * 2 - 1
  }
  return out
}

describe('evaluateQualification', () => {
  it('qualifies an independent 2-channel capture', () => {
    const r = evaluateQualification(report())
    expect(r.level).toBe('qualified')
    expect(r.spatialSupported).toBe(true)
    expect(r.reasons).toHaveLength(0)
  })

  it('rejects a capture that delivered mono (OS downmix to 1 channel)', () => {
    const r = evaluateQualification(report({ observedChannels: 1 }))
    expect(r.level).toBe('unsupported')
    expect(r.spatialSupported).toBe(false)
    expect(r.reasons.join(' ')).toMatch(/1 channel/)
    // And it should say *why* the request did not survive.
    expect(r.reasons.join(' ')).toMatch(/downmixed/i)
  })

  it('rejects duplicated channels (2 delivered, but the same signal)', () => {
    const r = evaluateQualification(report({ maxPairCorrelation: 1 }))
    expect(r.level).toBe('unsupported')
    expect(r.spatialSupported).toBe(false)
    expect(r.reasons.join(' ')).toMatch(/same signal/i)
  })

  it('never qualifies on weak evidence', () => {
    const r = evaluateQualification(report({ framesObserved: MIN_OBSERVATION_FRAMES - 1 }))
    expect(r.level).toBe('degraded')
    expect(r.spatialSupported).toBe(false)
  })

  it('degrades on high correlation, clipping and a dead channel', () => {
    expect(evaluateQualification(report({ maxPairCorrelation: 0.95 })).level).toBe('degraded')
    expect(evaluateQualification(report({ clipped: true })).level).toBe('degraded')
    expect(evaluateQualification(report({ energyRatio: ENERGY_IMBALANCE_RATIO / 2 })).level).toBe(
      'degraded',
    )
  })

  it('fails safe when no channel arrived at all', () => {
    const r = evaluateQualification(report({ observedChannels: 0 }))
    expect(r.level).toBe('unsupported')
    expect(r.spatialSupported).toBe(false)
  })

  it('flags delivering more channels than requested', () => {
    const r = evaluateQualification(report({ requestedChannels: 1, observedChannels: 2 }))
    expect(r.reasons.join(' ')).toMatch(/only 1 were requested/i)
  })
})

describe('ChannelProbe (worklet-side, allocation-free accounting)', () => {
  it('reports independent channels as uncorrelated', () => {
    const p = new ChannelProbe()
    for (let f = 0; f < 40; f++) {
      p.observe([noise(f * 2 + 1, 128), noise(f * 2 + 2, 128)])
    }
    expect(p.channels).toBe(2)
    expect(p.frames).toBe(40)
    expect(p.correlation).toBeLessThan(0.5)
    expect(evaluateQualification({
      requestedChannels: 2, observedChannels: p.channels, sampleRate: RATE,
      framesObserved: p.frames, maxPairCorrelation: p.correlation,
      clipped: p.clipped, energyRatio: p.energyRatio,
    }).level).toBe('qualified')
  })

  it('detects a duplicated channel', () => {
    const p = new ChannelProbe()
    for (let f = 0; f < 40; f++) {
      const ch = noise(f + 7, 128)
      p.observe([ch, ch]) // OS downmix / duplicated channel
    }
    expect(p.correlation).toBeGreaterThanOrEqual(DUPLICATE_CORRELATION)
  })

  it('detects a near-silent (dead) channel through the energy ratio', () => {
    const p = new ChannelProbe()
    for (let f = 0; f < 40; f++) {
      p.observe([noise(f + 3, 128), new Float32Array(128)])
    }
    expect(p.energyRatio).toBeLessThan(ENERGY_IMBALANCE_RATIO)
  })

  it('counts frames but correlates nothing when mono', () => {
    const p = new ChannelProbe()
    for (let f = 0; f < 20; f++) p.observe([noise(f + 1, 128)])
    expect(p.channels).toBe(1)
    expect(p.frames).toBe(20)
    // Silence / no second channel carries no independence evidence.
    expect(p.correlation).toBe(1)
  })

  it('flags clipping', () => {
    const p = new ChannelProbe()
    const loud = new Float32Array(128).fill(1.5)
    p.observe([loud, noise(1, 128)])
    expect(p.clipped).toBe(true)
  })
})