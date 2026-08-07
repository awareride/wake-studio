/**
 * Per-stage ring capture unit tests (epic #53 P5).
 *
 * RingCapture is the pure accumulator behind StageCapture: unbounded until
 * stop by default, and a max-sample ring (max-seconds cap) when configured.
 * The ring must keep the most recent samples exactly at the cap.
 */

import { describe, it, expect } from 'vitest'
import { RingCapture } from '../persistence/capture'

function chunk(len: number, fill: number): Float32Array {
  const a = new Float32Array(len)
  a.fill(fill)
  return a
}

describe('RingCapture (unbounded)', () => {
  it('accumulates chunks and concatenates in order', () => {
    const ring = new RingCapture('raw', 48000)
    ring.push(chunk(3, 1))
    ring.push(chunk(2, 2))
    expect(ring.length).toBe(5)
    const out = ring.concat()
    expect(Array.from(out)).toEqual([1, 1, 1, 2, 2])
  })

  it('reports isEmpty for no data and skips empty chunks', () => {
    const ring = new RingCapture('ns', 48000)
    expect(ring.isEmpty).toBe(true)
    ring.push(new Float32Array(0))
    expect(ring.isEmpty).toBe(true)
    ring.push(chunk(4, 0.5))
    expect(ring.isEmpty).toBe(false)
  })
})

describe('RingCapture (maxLen cap)', () => {
  it('drops the oldest samples once the cap is exceeded', () => {
    const ring = new RingCapture('raw', 48000, 10)
    ring.push(chunk(4, 1))
    ring.push(chunk(4, 2))
    expect(ring.length).toBe(8)
    ring.push(chunk(4, 3))
    // 12 pushed, cap 10 -> keep the most recent 10 (drop 2 oldest).
    expect(ring.length).toBe(10)
    const out = ring.concat()
    expect(Array.from(out)).toEqual([1, 1, 2, 2, 2, 2, 3, 3, 3, 3])
  })

  it('exactly respects the cap across many chunks', () => {
    const ring = new RingCapture('kws', 16000, 5)
    for (let i = 0; i < 100; i++) ring.push(chunk(3, i))
    expect(ring.length).toBe(5)
    // The ring keeps the newest 5 samples: the last 3-sample chunk (99)
    // plus the 2 oldest tail samples of the previous chunk (98).
    const out = ring.concat()
    expect(Array.from(out)).toEqual([98, 98, 99, 99, 99])
  })

  it('keeps only the tail of a single chunk at/over the cap', () => {
    const ring = new RingCapture('raw', 48000, 4)
    ring.push(chunk(10, 7))
    expect(ring.length).toBe(4)
    expect(Array.from(ring.concat())).toEqual([7, 7, 7, 7])
  })

  it('evicts down to the cap when the head chunk is partially dropped', () => {
    const ring = new RingCapture('raw', 48000, 7)
    ring.push(chunk(5, 1)) // 5
    ring.push(chunk(5, 2)) // 10 -> drop 3 from the head chunk
    expect(ring.length).toBe(7)
    expect(Array.from(ring.concat())).toEqual([1, 1, 2, 2, 2, 2, 2])
  })
})
