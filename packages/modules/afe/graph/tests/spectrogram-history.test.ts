/**
 * AFE graph module - SpectrogramHistory L1 unit tests (ADR-026).
 *
 * Locks the contiguous-window guarantee the worklet's spectrogram column
 * depends on (the processing ring wraps at 1920 samples; the FFT window is
 * 4096, so the history must stay contiguous across many wraps).
 */

import { describe, it, expect } from 'vitest'
import { SpectrogramHistory } from '../core/spectrogram-history'

describe('SpectrogramHistory', () => {
  it('zero-pads a window before enough samples are pushed', () => {
    const h = new SpectrogramHistory(64)
    h.push(new Float32Array([1, 2, 3]))
    const w = h.window(8)
    expect(Array.from(w)).toEqual([0, 0, 0, 0, 0, 1, 2, 3])
    expect(h.length).toBe(3)
  })

  it('returns the newest samples as a contiguous window', () => {
    const h = new SpectrogramHistory(16)
    h.push(new Float32Array([1, 2, 3, 4, 5]))
    h.push(new Float32Array([6, 7, 8]))
    expect(Array.from(h.window(8))).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('evicts the oldest samples when full', () => {
    const h = new SpectrogramHistory(8)
    h.push(new Float32Array([1, 2, 3, 4, 5]))
    h.push(new Float32Array([6, 7, 8, 9]))
    // Newest 8 = [2..9]; 1 was evicted.
    expect(Array.from(h.window(8))).toEqual([2, 3, 4, 5, 6, 7, 8, 9])
    expect(h.length).toBe(8)
  })

  it('stays contiguous across many wraps (quantum-sized pushes)', () => {
    const h = new SpectrogramHistory(32)
    const all: number[] = []
    for (let i = 0; i < 40; i++) {
      const chunk = new Float32Array(5)
      for (let j = 0; j < 5; j++) chunk[j] = i * 5 + j + 1
      h.push(chunk)
      for (const v of chunk) {
        all.push(v)
        if (all.length > 32) all.shift()
      }
    }
    expect(Array.from(h.window(32))).toEqual(all)
  })

  it('handles a chunk larger than the history (keep newest only)', () => {
    const h = new SpectrogramHistory(8)
    const big = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    h.push(big)
    expect(Array.from(h.window(8))).toEqual([3, 4, 5, 6, 7, 8, 9, 10])
    expect(h.length).toBe(8)
  })

  it('clear resets length and windows', () => {
    const h = new SpectrogramHistory(8)
    h.push(new Float32Array([1, 2, 3]))
    h.clear()
    expect(h.length).toBe(0)
    expect(Array.from(h.window(8))).toEqual([0, 0, 0, 0, 0, 0, 0, 0])
  })
})
