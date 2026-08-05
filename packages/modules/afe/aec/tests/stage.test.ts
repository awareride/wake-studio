import { describe, it, expect } from 'vitest'
import { AecStage } from '../core'

describe('AecStage (v1 passthrough)', () => {
  it('implements the AFEStage interface', () => {
    const s = new AecStage()
    expect(s.kind).toBe('aec')
    expect(typeof s.process).toBe('function')
    expect(typeof s.reset).toBe('function')
  })

  it('passes frames through unchanged (v1)', () => {
    const s = new AecStage()
    const frame = new Float32Array([0.1, -0.2, 0.3])
    const out = frame.slice()
    s.process(out)
    expect(Array.from(out)).toEqual(Array.from(frame))
  })

  it('reports a level (dBFS) for non-silent frames', () => {
    const s = new AecStage()
    const r = s.process(new Float32Array(480).fill(0.5))
    expect(r.levelDb).toBeGreaterThan(-120)
    expect(r.vadProbability).toBe(0) // AEC does not gate VAD
  })
})
