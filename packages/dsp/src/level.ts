/**
 * Level meters + resample + visualization helpers.
 *
 * Ported from afe/graph and few-shot module DSP; kept dependency-free.
 *
 * @see ADR-032 (DSP platform package)
 */

/** Peak level in dBFS (full scale = 0 dBFS). Returns -Infinity for silence. */
export function peakDbfs(samples: Float32Array): number {
  let peak = 0
  for (let i = 0; i < samples.length; i++) {
    const abs = Math.abs(samples[i])
    if (abs > peak) peak = abs
  }
  if (peak === 0) return -Infinity
  return 20 * Math.log10(peak)
}

/** RMS level in dBFS. Returns -Infinity for silence. */
export function rmsDbfs(samples: Float32Array): number {
  if (samples.length === 0) return -Infinity
  let sumSq = 0
  for (let i = 0; i < samples.length; i++) {
    sumSq += samples[i] * samples[i]
  }
  const rms = Math.sqrt(sumSq / samples.length)
  if (rms === 0) return -Infinity
  return 20 * Math.log10(rms)
}

/** True if any sample reaches the clipping threshold (±threshold). */
export function isClipped(samples: Float32Array, threshold = 0.99): boolean {
  for (let i = 0; i < samples.length; i++) {
    if (Math.abs(samples[i]) >= threshold) return true
  }
  return false
}

/** Simple RMS (linear) of a frame. */
export function frameRms(frame: Float32Array): number {
  let sum = 0
  for (let i = 0; i < frame.length; i++) {
    sum += frame[i] * frame[i]
  }
  return Math.sqrt(sum / Math.max(1, frame.length))
}

/** Apply a gain to a frame in place. */
export function applyGain(frame: Float32Array, gain: number): void {
  for (let i = 0; i < frame.length; i++) {
    frame[i] *= gain
  }
}

/**
 * Estimate signal-to-noise ratio in dB using a simple energy-gating approach:
 * the top 20% of frames (by energy) are "signal", the bottom 20% are "noise".
 * Returns a rough SNR suitable for quality gating (not a precise measurement).
 */
export function estimateSnrDb(samples: Float32Array, frameSize = 320): number {
  if (samples.length < frameSize * 5) return 0
  const energies: number[] = []
  for (let i = 0; i + frameSize <= samples.length; i += frameSize) {
    let sumSq = 0
    for (let j = i; j < i + frameSize; j++) {
      sumSq += samples[j] * samples[j]
    }
    energies.push(sumSq / frameSize)
  }
  energies.sort((a, b) => a - b)
  const n = energies.length
  const noiseCount = Math.max(1, Math.floor(n * 0.2))
  const signalCount = Math.max(1, Math.floor(n * 0.2))
  let noiseEnergy = 0
  for (let i = 0; i < noiseCount; i++) noiseEnergy += energies[i]
  noiseEnergy /= noiseCount
  let signalEnergy = 0
  for (let i = n - signalCount; i < n; i++) signalEnergy += energies[i]
  signalEnergy /= signalCount
  if (noiseEnergy === 0) return 40 // very high SNR (no noise floor)
  return 10 * Math.log10(signalEnergy / noiseEnergy)
}

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
