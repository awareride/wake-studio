/**
 * KWS engine - the "never triggers" regression.
 *
 * Reported: with the kws-streaming backend, speaking a keyword never fired a
 * trigger even though the model was confident.
 *
 * FIRST HYPOTHESIS (WRONG - kept as a test because it must stay wrong):
 * "the worker pushes 0 when processFrame returns null, so the smoothed score
 * collapses between hops and min-duration never accumulates." A test of the
 * pipeline showed it triggers fine, because the worker `return`s early on null
 * and never advances the trigger on those frames - the detector only ever sees
 * hop frames, where the score IS high.
 *
 * ACTUAL ROOT CAUSE: a unit mismatch. `AFEOutputFrame.capturedAtMs` carried
 * `AudioContext.currentTime`, which is in SECONDS (the AFE's own latency math
 * multiplied it by 1000). `TriggerDetector` compares that timestamp against
 * `minDurationMs` (300) and `cooldownMs` (2000), so it required 300 *seconds*
 * of continuous above-threshold score before firing. No amount of speaking
 * could trigger it.
 *
 * These tests pin the timestamp contract in milliseconds.
 */

import { describe, it, expect } from 'vitest'
import { ScoreSmoother, TriggerDetector } from '../core/logic'
import { DEFAULT_CONFIG } from '../core/defaults'

/** Drive the score pipeline the way the worker does, over `frames` x 10 ms. */
function runPipeline({
  score,
  frames,
  msPerFrame,
  hopFrames = 1,
  minDurationMs = DEFAULT_CONFIG.minDurationMs,
  cooldownMs = DEFAULT_CONFIG.cooldownMs,
  threshold = DEFAULT_CONFIG.threshold,
}: {
  score: number
  frames: number
  /**
   * Timestamp increment per 10 ms AFE frame: 10 when the clock is in
   * milliseconds (correct), 0.01 when it carries raw AudioContext seconds
   * (the bug).
   */
  msPerFrame: number
  hopFrames?: number
  minDurationMs?: number
  cooldownMs?: number
  threshold?: number
}): number {
  const smoother = new ScoreSmoother(DEFAULT_CONFIG.smoothingWindowFrames)
  const trigger = new TriggerDetector(threshold, minDurationMs, cooldownMs)
  let triggers = 0
  for (let i = 0; i < frames; i++) {
    // Only hop frames produce a score (the worker returns early otherwise).
    if (i % hopFrames !== 0) continue
    const smoothed = smoother.push(score)
    if (trigger.process(smoothed, i * msPerFrame)) triggers++
  }
  return triggers
}

describe('trigger timestamps must be MILLISECONDS (never-triggers bug)', () => {
  // 2 s of a confident keyword, scored once per 100 ms hop (kws-streaming).
  const scenario = { score: 0.95, frames: 200, hopFrames: 10 }

  it('REPRODUCES the bug: seconds-valued timestamps never trigger', () => {
    // AudioContext.currentTime advances 0.01 per 10 ms frame, so 2 s of speech
    // moves the clock by 2 - nowhere near the 300 the detector wants.
    expect(runPipeline({ ...scenario, msPerFrame: 0.01 })).toBe(0)
  })

  it('FIXES it: millisecond timestamps trigger as configured', () => {
    expect(runPipeline({ ...scenario, msPerFrame: 10 })).toBeGreaterThan(0)
  })

  it('fires only after minDurationMs has really elapsed', () => {
    // 300 ms min duration: 250 ms of speech must NOT fire, 400 ms must.
    expect(
      runPipeline({ score: 0.95, frames: 25, hopFrames: 10, msPerFrame: 10 }),
    ).toBe(0)
    expect(
      runPipeline({ score: 0.95, frames: 40, hopFrames: 10, msPerFrame: 10 }),
    ).toBeGreaterThan(0)
  })

  it('respects cooldownMs in real time (one trigger per 2 s)', () => {
    // 5 s of continuous keyword with a 2 s cooldown => 2-3 triggers, not dozens.
    const triggers = runPipeline({
      score: 0.95,
      frames: 500,
      hopFrames: 10,
      msPerFrame: 10,
    })
    expect(triggers).toBeGreaterThanOrEqual(2)
    expect(triggers).toBeLessThanOrEqual(3)
  })

  it('still does not trigger below the threshold', () => {
    expect(
      runPipeline({ score: 0.1, frames: 500, hopFrames: 10, msPerFrame: 10 }),
    ).toBe(0)
  })

  it('the null-as-zero policy was NOT the cause (hypothesis stays refuted)', () => {
    // The worker returns early on null, so the detector never sees the zeros.
    // Scoring only on hop frames still triggers, provided the clock is in ms.
    for (const hopFrames of [1, 8, 10, 50]) {
      expect(
        runPipeline({ score: 0.9, frames: 400, hopFrames, msPerFrame: 10 }),
        `hop of ${hopFrames} frames should still trigger`,
      ).toBeGreaterThan(0)
    }
  })
})
