import { describe, it, expect } from 'vitest'
import {
  cosineSimilarity,
  squaredEuclidean,
  plixScore,
  meanPool,
  peakDbfs,
  rmsDbfs,
  isClipped,
  estimateSnrDb,
  checkSampleQuality,
} from '../core/quality'

// ---------------------------------------------------------------------------
// cosineSimilarity
// ---------------------------------------------------------------------------

describe('cosineSimilarity', () => {
  it('returns 1.0 for identical vectors (rescaled)', () => {
    const a = new Float32Array([1, 2, 3])
    expect(cosineSimilarity(a, a)).toBeCloseTo(1.0, 5)
  })

  it('returns 0.0 for orthogonal vectors (rescaled: (0+1)/2)', () => {
    const a = new Float32Array([1, 0])
    const b = new Float32Array([0, 1])
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.5, 5)
  })

  it('returns 0.0 for opposite vectors (rescaled: (-1+1)/2)', () => {
    const a = new Float32Array([1, 2, 3])
    const b = new Float32Array([-1, -2, -3])
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.0, 5)
  })

  it('returns 0 for zero-norm vectors (no NaN)', () => {
    const zero = new Float32Array([0, 0, 0])
    const a = new Float32Array([1, 2, 3])
    expect(cosineSimilarity(zero, a)).toBe(0)
    expect(cosineSimilarity(a, zero)).toBe(0)
  })

  it('returns 0 for mismatched lengths', () => {
    expect(cosineSimilarity(new Float32Array([1, 2]), new Float32Array([1]))).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// squaredEuclidean (PLiX prototype-distance metric)
// ---------------------------------------------------------------------------

describe('squaredEuclidean', () => {
  it('is 0 for identical vectors', () => {
    const a = new Float32Array([1, 2, 3])
    expect(squaredEuclidean(a, a)).toBeCloseTo(0, 6)
  })

  it('computes the sum of squared differences', () => {
    const a = new Float32Array([1, 2, 3])
    const b = new Float32Array([4, 6, 8]) // diffs 3,4,5 -> 9+16+25 = 50
    expect(squaredEuclidean(a, b)).toBeCloseTo(50, 6)
  })

  it('is symmetric', () => {
    const a = new Float32Array([0.1, -2.3, 4.5])
    const b = new Float32Array([1.9, 0.2, -0.4])
    expect(squaredEuclidean(a, b)).toBeCloseTo(squaredEuclidean(b, a), 6)
  })

  it('returns 0 for mismatched lengths', () => {
    expect(squaredEuclidean(new Float32Array([1, 2]), new Float32Array([1]))).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// plixScore (rescale squared distance to [0,1])
// ---------------------------------------------------------------------------

describe('plixScore', () => {
  it('is 1.0 at zero distance (exact match)', () => {
    expect(plixScore(0)).toBeCloseTo(1, 6)
  })

  it('decreases as distance grows', () => {
    const s1 = plixScore(1)
    const s2 = plixScore(10)
    expect(s1).toBeCloseTo(0.5, 6)
    expect(s2).toBeCloseTo(1 / 11, 6)
    expect(s1).toBeGreaterThan(s2)
  })

  it('stays within [0,1]', () => {
    expect(plixScore(0)).toBeLessThanOrEqual(1)
    expect(plixScore(1e6)).toBeGreaterThanOrEqual(0)
    expect(plixScore(1e6)).toBeLessThanOrEqual(1)
  })

  it('clamps negative / non-finite distances to 0', () => {
    expect(plixScore(-1)).toBe(0)
    expect(plixScore(NaN)).toBe(0)
    expect(plixScore(Infinity)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// meanPool
// ---------------------------------------------------------------------------

describe('meanPool', () => {
  it('pools two embeddings by averaging', () => {
    const a = new Float32Array([1, 3, 5])
    const b = new Float32Array([3, 1, 7])
    const pool = meanPool([a, b])
    expect(Array.from(pool)).toEqual([2, 2, 6])
  })

  it('returns the single embedding unchanged (as a copy)', () => {
    const a = new Float32Array([1, 2, 3])
    const pool = meanPool([a])
    expect(Array.from(pool)).toEqual([1, 2, 3])
  })

  it('returns empty for no embeddings', () => {
    expect(meanPool([]).length).toBe(0)
  })

  it('does not mutate inputs', () => {
    const a = new Float32Array([1, 2])
    const b = new Float32Array([3, 4])
    meanPool([a, b])
    expect(Array.from(a)).toEqual([1, 2])
    expect(Array.from(b)).toEqual([3, 4])
  })
})

// ---------------------------------------------------------------------------
// peakDbfs / rmsDbfs / isClipped
// ---------------------------------------------------------------------------

describe('peakDbfs', () => {
  it('returns 0 for full-scale signal', () => {
    expect(peakDbfs(new Float32Array([1, -1, 1]))).toBeCloseTo(0, 3)
  })
  it('returns -Infinity for silence', () => {
    expect(peakDbfs(new Float32Array([0, 0, 0]))).toBe(-Infinity)
  })
  it('returns -6 dBFS for half-amplitude', () => {
    expect(peakDbfs(new Float32Array([0.5]))).toBeCloseTo(-6.0206, 3)
  })
})

describe('rmsDbfs', () => {
  it('returns -3 dBFS for full-scale square wave', () => {
    const rms = rmsDbfs(new Float32Array([1, -1, 1, -1]))
    expect(rms).toBeCloseTo(0, 3) // RMS of ±1 = 1 -> 0 dBFS
  })
})

describe('isClipped', () => {
  it('detects clipping at ±0.99', () => {
    expect(isClipped(new Float32Array([0.5, 0.99, 0.3]))).toBe(true)
    expect(isClipped(new Float32Array([0.5, -0.991, 0.3]))).toBe(true)
  })
  it('returns false for clean signal', () => {
    expect(isClipped(new Float32Array([0.5, 0.8, -0.7]))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// estimateSnrDb
// ---------------------------------------------------------------------------

describe('estimateSnrDb', () => {
  it('returns high SNR for clean signal with silence', () => {
    // First half: loud signal; second half: silence
    const samples = new Float32Array(3200)
    for (let i = 0; i < 1600; i++) samples[i] = Math.sin(i * 0.1) * 0.8
    const snr = estimateSnrDb(samples)
    expect(snr).toBeGreaterThan(20)
  })
  it('returns low SNR for uniform noise', () => {
    const samples = new Float32Array(3200)
    for (let i = 0; i < 3200; i++) samples[i] = (Math.random() - 0.5) * 0.5
    const snr = estimateSnrDb(samples)
    expect(snr).toBeLessThan(15)
  })
})

// ---------------------------------------------------------------------------
// checkSampleQuality
// ---------------------------------------------------------------------------

describe('checkSampleQuality', () => {
  const SR = 16000

  it('passes a good sample', () => {
    const samples = new Float32Array(SR * 1) // 1 second
    // Speech-like: signal bursts with silence gaps (so SNR is measurable)
    for (let i = 0; i < samples.length; i++) {
      const t = i / SR
      const burst = Math.sin(i * 0.1) * 0.3 * (Math.floor(t * 10) % 2)
      samples[i] = burst
    }
    const q = checkSampleQuality(samples, SR)
    expect(q.clipped).toBe(false)
    expect(q.acceptable).toBe(true)
    expect(q.durationMs).toBeCloseTo(1000, 0)
  })

  it('fails a clipped sample', () => {
    const samples = new Float32Array(SR * 1)
    for (let i = 0; i < samples.length; i++) samples[i] = Math.sin(i * 0.1) * 1.5
    const q = checkSampleQuality(samples, SR)
    expect(q.clipped).toBe(true)
    expect(q.acceptable).toBe(false)
  })

  it('fails a too-short sample', () => {
    const samples = new Float32Array(SR * 0.1) // 100 ms
    const q = checkSampleQuality(samples, SR)
    expect(q.acceptable).toBe(false)
  })

  it('fails a too-quiet sample', () => {
    const samples = new Float32Array(SR * 1)
    for (let i = 0; i < samples.length; i++) samples[i] = Math.sin(i * 0.1) * 0.001
    const q = checkSampleQuality(samples, SR)
    expect(q.acceptable).toBe(false)
  })
})
