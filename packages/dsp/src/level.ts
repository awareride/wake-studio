/**
 * Resample + visualization helpers (ported from afe/graph core dsp.ts).
 *
 * These are intentionally simple and dependency-free: averaging downsampler
 * (48k->16k) and nearest-sample decimation for waveform visualization.
 *
 * @see ADR-032 (DSP platform package)
 */

/**
 * Downsample 48 kHz -> 16 kHz by averaging groups of 3 samples.
 * Input length must be a multiple of 3. Returns a new Float32Array.
 */
export function downsample48to16(frame480: Float32Array): Float32Array {
  const ratio = 3
  const out = new Float32Array(frame480.length / ratio)
  for (let i = 0, j = 0; i < frame480.length; i += ratio, j++) {
    let sum = 0
    for (let k = 0; k < ratio; k++) {
      sum += frame480[i + k]
    }
    out[j] = sum / ratio
  }
  return out
}

/**
 * Downsample a frame to N points for waveform display (nearest-sample pick).
 * The output has exactly `points` samples regardless of input length.
 */
export function downsampleForViz(
  frame: Float32Array,
  points: number,
): Float32Array {
  const out = new Float32Array(points)
  const step = frame.length / points
  for (let i = 0; i < points; i++) {
    out[i] = frame[Math.floor(i * step)]
  }
  return out
}

/**
 * Compute RMS level in dBFS for a frame.
 * Returns -120 for near-silence (avoids -Infinity from log10(0)).
 */
export function levelDb(frame: Float32Array): number {
  let sum = 0
  for (let i = 0; i < frame.length; i++) {
    sum += frame[i] * frame[i]
  }
  const rms = Math.sqrt(sum / frame.length)
  return rms < 1e-10 ? -120 : 20 * Math.log10(rms)
}
