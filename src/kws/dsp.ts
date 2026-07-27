/**
 * KWS module - pure logic (testable, no ONNX dependency).
 *
 * Extracted from the worker for unit testing per docs/modules/kws.md §9.
 * These classes have no dependency on onnxruntime-web or the Web Worker
 * environment and can run in any JS context (Node, browser, worker).
 */

/**
 * Score smoother: sliding-window max-pooling.
 *
 * Keeps a ring buffer of the last `windowSize` raw scores and returns the max.
 * Max-pooling (vs. mean) is chosen because it preserves peak sensitivity -
 * a brief high-score spike should not be averaged away.
 */
export class ScoreSmoother {
  private _buffer: number[]
  private _index = 0
  private _filled = false

  constructor(windowSize: number) {
    this._buffer = new Array(windowSize).fill(0)
  }

  /** Push a raw score and return the smoothed (max) score. */
  push(rawScore: number): number {
    this._buffer[this._index] = rawScore
    this._index = (this._index + 1) % this._buffer.length
    if (this._index === 0) this._filled = true

    let max = this._buffer[0]
    for (let i = 1; i < this._buffer.length; i++) {
      if (this._buffer[i] > max) max = this._buffer[i]
    }
    return max
  }

  /** Reset the buffer (e.g. when the smoothing window size changes). */
  reset(): void {
    this._buffer.fill(0)
    this._index = 0
    this._filled = false
  }

  /** Whether the buffer has been fully filled at least once. */
  get warmedUp(): boolean {
    return this._filled
  }
}

/**
 * Trigger detector: threshold + min-duration + cooldown.
 *
 * Fires a trigger when:
 *   1. The smoothed score exceeds `threshold`.
 *   2. It has exceeded the threshold for at least `minDurationMs` continuously.
 *   3. The `cooldownMs` since the last trigger has elapsed.
 *
 * Returns the trigger event (with peak score) when it fires, or null otherwise.
 */
export class TriggerDetector {
  private _threshold: number
  private _minDurationMs: number
  private _cooldownMs: number
  private _aboveSinceMs: number | null = null
  private _lastTriggerMs = -Infinity
  private _word: string

  constructor(
    threshold: number,
    minDurationMs: number,
    cooldownMs: number,
    word = 'wake-word',
  ) {
    this._threshold = threshold
    this._minDurationMs = minDurationMs
    this._cooldownMs = cooldownMs
    this._word = word
  }

  /**
   * Process a smoothed score at the given time.
   * Returns a trigger event if one fires, or null.
   */
  process(smoothedScore: number, nowMs: number): {
    triggeredAtMs: number
    peakScore: number
    word: string
  } | null {
    const aboveThreshold = smoothedScore >= this._threshold

    if (aboveThreshold) {
      // Start tracking when we first cross the threshold.
      if (this._aboveSinceMs === null) {
        this._aboveSinceMs = nowMs
      }

      // Check min-duration + cooldown.
      const durationMet = nowMs - this._aboveSinceMs >= this._minDurationMs
      const cooldownElapsed = nowMs - this._lastTriggerMs >= this._cooldownMs

      if (durationMet && cooldownElapsed) {
        this._lastTriggerMs = nowMs
        // Keep _aboveSinceMs so we don't re-trigger immediately; it resets when
        // the score drops below threshold.
        return {
          triggeredAtMs: nowMs,
          peakScore: smoothedScore,
          word: this._word,
        }
      }
    } else {
      // Score dropped below threshold - reset the duration tracker.
      this._aboveSinceMs = null
    }

    return null
  }

  /** Update the detector's parameters (applied on the next process() call). */
  configure(threshold: number, minDurationMs: number, cooldownMs: number): void {
    this._threshold = threshold
    this._minDurationMs = minDurationMs
    this._cooldownMs = cooldownMs
  }

  /** Reset internal state (e.g. on stop). */
  reset(): void {
    this._aboveSinceMs = null
    this._lastTriggerMs = -Infinity
  }
}

/**
 * VAD gate: decide whether to skip inference for a frame.
 *
 * Returns true if the frame should be gated (skipped) based on the VAD
 * probability and the gate threshold.
 */
export function shouldGateByVad(
  vadProbability: number,
  vadThreshold: number,
  gateEnabled: boolean,
): boolean {
  if (!gateEnabled) return false
  return vadProbability < vadThreshold
}
