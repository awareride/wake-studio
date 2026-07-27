/**
 * Few-Shot module - pure logic (testable, no ONNX/WavLM dependency).
 *
 * Cosine similarity, prototype mean-pooling, and sample-quality checks.
 * Extracted for unit testing per docs/modules/few-shot.md §9.
 */

/**
 * Cosine similarity between two vectors, rescaled to [0,1].
 *
 * cos(a,b) = dot(a,b) / (||a|| * ||b||), then (cos + 1) / 2 so the existing
 * threshold/min-duration UI (tuned for [0,1] posteriors) works unchanged.
 * Returns 0 if either vector has zero norm (avoid NaN).
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) return 0
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  if (normA === 0 || normB === 0) return 0
  const cos = dot / (Math.sqrt(normA) * Math.sqrt(normB))
  return (cos + 1) / 2
}

/**
 * Mean-pool an array of embeddings into a single prototype vector.
 *
 * All embeddings must have the same dimensionality. Returns a new Float32Array
 * (does not mutate inputs).
 */
export function meanPool(embeddings: Float32Array[]): Float32Array {
  if (embeddings.length === 0) return new Float32Array(0)
  const dim = embeddings[0].length
  const result = new Float32Array(dim)
  for (const emb of embeddings) {
    for (let i = 0; i < dim; i++) {
      result[i] += emb[i]
    }
  }
  const n = embeddings.length
  for (let i = 0; i < dim; i++) {
    result[i] /= n
  }
  return result
}

/** Peak level in dBFS (full scale = 0 dBFS). */
export function peakDbfs(samples: Float32Array): number {
  let peak = 0
  for (let i = 0; i < samples.length; i++) {
    const abs = Math.abs(samples[i])
    if (abs > peak) peak = abs
  }
  if (peak === 0) return -Infinity
  return 20 * Math.log10(peak)
}

/** RMS level in dBFS. */
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

/** True if any sample reaches the clipping threshold (±1.0). */
export function isClipped(samples: Float32Array, threshold = 0.99): boolean {
  for (let i = 0; i < samples.length; i++) {
    if (Math.abs(samples[i]) >= threshold) return true
  }
  return false
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

/** Quality metrics for an enrollment sample. */
export interface SampleQuality {
  peakDbfs: number
  snrDb: number
  durationMs: number
  clipped: boolean
  /** Overall pass/fail: not clipped, level in range, SNR above minimum. */
  acceptable: boolean
}

/**
 * Check the quality of an enrollment sample at the given sample rate.
 *
 * Defaults: peak -30 to -3 dBFS, SNR >= 10 dB, duration 300-3000 ms, no clip.
 */
export function checkSampleQuality(
  samples: Float32Array,
  sampleRate: number,
  opts: {
    minPeakDbfs?: number
    maxPeakDbfs?: number
    minSnrDb?: number
    minDurationMs?: number
    maxDurationMs?: number
    clipThreshold?: number
  } = {},
): SampleQuality {
  const minPeak = opts.minPeakDbfs ?? -35
  const maxPeak = opts.maxPeakDbfs ?? -3
  const minSnr = opts.minSnrDb ?? 10
  const minDur = opts.minDurationMs ?? 300
  const maxDur = opts.maxDurationMs ?? 3000
  const clipThr = opts.clipThreshold ?? 0.99

  const peak = peakDbfs(samples)
  const snr = estimateSnrDb(samples)
  const clipped = isClipped(samples, clipThr)
  const durationMs = (samples.length / sampleRate) * 1000

  const levelOk = peak >= minPeak && peak <= maxPeak
  const snrOk = snr >= minSnr
  const durOk = durationMs >= minDur && durationMs <= maxDur

  return {
    peakDbfs: peak,
    snrDb: snr,
    durationMs,
    clipped,
    acceptable: !clipped && levelOk && snrOk && durOk,
  }
}
