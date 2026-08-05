/**
 * RNNoise module - pure DSP helpers (L1-unit-testable, no wasm dependency).
 */

/** RNNoise processes exactly 480 float32 samples per frame (10 ms at 48 kHz). */
export const RNNOISE_FRAME_SIZE = 480

/** RNNoise's raw VAD score is a float in [0, 1] after a sigmoid-like mapping. */
export function vadToProbability(raw: number): number {
  return Math.max(0, Math.min(1, raw))
}

/** Simple level (RMS) of a frame, for visualization and tests. */
export function frameRms(frame: Float32Array): number {
  let sum = 0
  for (let i = 0; i < frame.length; i++) {
    sum += frame[i] * frame[i]
  }
  return Math.sqrt(sum / Math.max(1, frame.length))
}

/** Apply a gain (e.g. "strength" slider) to a denoised frame. */
export function applyGain(frame: Float32Array, gain: number): void {
  for (let i = 0; i < frame.length; i++) {
    frame[i] *= gain
  }
}
