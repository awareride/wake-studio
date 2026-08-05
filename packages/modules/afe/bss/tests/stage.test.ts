import { describe, it, expect } from 'vitest'
import { BssStage } from '../core'

describe('BssStage (v1 passthrough)', () => {
  it('implements the AFEStage interface', () => {
    const s = new BssStage()
    expect(s.kind).toBe('bss')
    expect(typeof s.process).toBe('function')
    expect(typeof s.reset).toBe('function')
  })

  it('passes frames through unchanged (v1 single-mic)', () => {
    const s = new BssStage()
    const frame = new Float32Array([0.2, -0.1, 0.4])
    const out = frame.slice()
    s.process(out)
    expect(Array.from(out)).toEqual(Array.from(frame))
  })

  it('reports a level (dBFS) for non-silent frames', () => {
    const s = new BssStage()
    const r = s.process(new Float32Array(480).fill(0.3))
    expect(r.levelDb).toBeGreaterThan(-120)
    expect(r.vadProbability).toBe(0) // BSS does not gate VAD
  })
})
