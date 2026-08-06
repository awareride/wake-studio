import { describe, it, expect } from 'vitest'
import { ScoreSmoother, TriggerDetector, shouldGateByVad } from '../core/logic'

// ---------------------------------------------------------------------------
// ScoreSmoother
// ---------------------------------------------------------------------------

describe('ScoreSmoother', () => {
  it('returns the max of the window', () => {
    const s = new ScoreSmoother(3)
    expect(s.push(0.1)).toBe(0.1)
    expect(s.push(0.5)).toBe(0.5)
    expect(s.push(0.3)).toBe(0.5)
  })

  it('drops old values when the window slides', () => {
    const s = new ScoreSmoother(3)
    s.push(0.1)
    s.push(0.9)
    s.push(0.2)
    // Buffer: [0.1, 0.9, 0.2], max = 0.9
    expect(s.push(0.1)).toBe(0.9) // [0.1, 0.9, 0.2] (index 0 re-set to 0.1), max 0.9
    expect(s.push(0.1)).toBe(0.2) // [0.1, 0.1, 0.2] (index 1 overwrites 0.9), max 0.2
    expect(s.push(0.1)).toBe(0.1) // [0.1, 0.1, 0.1] (index 2 overwrites 0.2), max 0.1
  })

  it('handles single-element window', () => {
    const s = new ScoreSmoother(1)
    expect(s.push(0.3)).toBe(0.3)
    expect(s.push(0.7)).toBe(0.7)
  })

  it('reset clears the buffer', () => {
    const s = new ScoreSmoother(3)
    s.push(0.9)
    s.reset()
    expect(s.push(0.1)).toBe(0.1)
  })

  it('warmedUp is false initially, true after one full cycle', () => {
    const s = new ScoreSmoother(3)
    expect(s.warmedUp).toBe(false)
    s.push(0.1)
    s.push(0.1)
    s.push(0.1)
    expect(s.warmedUp).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// TriggerDetector
// ---------------------------------------------------------------------------

describe('TriggerDetector', () => {
  it('does not trigger below threshold', () => {
    const d = new TriggerDetector(0.5, 100, 1000)
    expect(d.process(0.3, 0)).toBeNull()
    expect(d.process(0.4, 50)).toBeNull()
  })

  it('does not trigger before min-duration is met', () => {
    const d = new TriggerDetector(0.5, 500, 1000)
    expect(d.process(0.8, 0)).toBeNull()
    expect(d.process(0.8, 200)).toBeNull()
    expect(d.process(0.8, 400)).toBeNull()
  })

  it('triggers when threshold + min-duration are met', () => {
    const d = new TriggerDetector(0.5, 500, 1000)
    expect(d.process(0.8, 0)).toBeNull()
    expect(d.process(0.8, 250)).toBeNull()
    const trigger = d.process(0.8, 500)
    expect(trigger).not.toBeNull()
    expect(trigger!.triggeredAtMs).toBe(500)
    expect(trigger!.peakScore).toBe(0.8)
  })

  it('resets duration when score drops below threshold', () => {
    const d = new TriggerDetector(0.5, 500, 1000)
    d.process(0.8, 0)
    d.process(0.8, 250)
    d.process(0.3, 300) // drop below
    d.process(0.8, 400) // restart, aboveSinceMs = 400
    expect(d.process(0.8, 899)).toBeNull() // 499ms < 500ms
    expect(d.process(0.8, 900)).not.toBeNull() // 500ms >= 500ms
  })

  it('respects cooldown', () => {
    const d = new TriggerDetector(0.5, 100, 1000)
    // At time 0: score exceeds threshold, but duration = 0 < 100.
    expect(d.process(0.8, 0)).toBeNull()
    // At time 100: duration = 100 >= 100, cooldown from -Infinity -> triggers.
    const t1 = d.process(0.8, 100)
    expect(t1).not.toBeNull()
    expect(t1!.triggeredAtMs).toBe(100)

    // Cooldown: should not trigger again until 1100.
    expect(d.process(0.8, 200)).toBeNull()
    expect(d.process(0.8, 500)).toBeNull()
    expect(d.process(0.8, 1099)).toBeNull()
    const t2 = d.process(0.8, 1100)
    expect(t2).not.toBeNull()
  })

  it('configure updates parameters', () => {
    const d = new TriggerDetector(0.5, 500, 1000)
    d.configure(0.3, 100, 500)
    // Now threshold is 0.3, min-duration 100, cooldown 500.
    expect(d.process(0.35, 0)).toBeNull()
    expect(d.process(0.35, 100)).not.toBeNull()
  })

  it('reset clears state', () => {
    const d = new TriggerDetector(0.5, 100, 1000)
    d.process(0.8, 0)
    d.process(0.8, 100) // triggers
    d.reset()
    // After reset, should need full min-duration again.
    expect(d.process(0.8, 200)).toBeNull()
    expect(d.process(0.8, 300)).not.toBeNull()
  })

  it('includes the word in the trigger event', () => {
    const d = new TriggerDetector(0.5, 100, 1000, 'hey-wave')
    d.process(0.9, 0) // aboveSinceMs = 0
    const trigger = d.process(0.9, 100) // duration = 100 >= 100
    expect(trigger).not.toBeNull()
    expect(trigger!.word).toBe('hey-wave')
  })
})

// ---------------------------------------------------------------------------
// shouldGateByVad
// ---------------------------------------------------------------------------

describe('shouldGateByVad', () => {
  it('returns false when gate is disabled', () => {
    expect(shouldGateByVad(0.0, 0.5, false)).toBe(false)
    expect(shouldGateByVad(0.1, 0.5, false)).toBe(false)
  })

  it('returns true when VAD is below threshold and gate is enabled', () => {
    expect(shouldGateByVad(0.1, 0.3, true)).toBe(true)
    expect(shouldGateByVad(0.0, 0.3, true)).toBe(true)
  })

  it('returns false when VAD is at or above threshold', () => {
    expect(shouldGateByVad(0.3, 0.3, true)).toBe(false)
    expect(shouldGateByVad(0.5, 0.3, true)).toBe(false)
    expect(shouldGateByVad(1.0, 0.3, true)).toBe(false)
  })

  it('boundary: exactly at threshold is not gated', () => {
    expect(shouldGateByVad(0.299, 0.3, true)).toBe(true)
    expect(shouldGateByVad(0.3, 0.3, true)).toBe(false)
  })
})
