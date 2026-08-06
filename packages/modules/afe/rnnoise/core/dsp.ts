/**
 * RNNoise module - pure DSP helpers (L1-unit-testable, no wasm dependency).
 *
 * The numeric helpers (frameRms, applyGain) live in `@wake-studio/dsp`
 * (ADR-032) and are re-exported here for call-site compatibility.
 */

import { frameRms, applyGain } from '@wake-studio/dsp'

export { frameRms, applyGain }

/** RNNoise processes exactly 480 float32 samples per frame (10 ms at 48 kHz). */
export const RNNOISE_FRAME_SIZE = 480

/** RNNoise's raw VAD score is a float in [0, 1] after a sigmoid-like mapping. */
export function vadToProbability(raw: number): number {
  return Math.max(0, Math.min(1, raw))
}
