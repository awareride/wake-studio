/**
 * Few-Shot module - pure logic (testable, no ONNX/encoder dependency).
 *
 * Vector metrics (cosine similarity) and sample-quality assembly. The numeric
 * DSP (peak/RMS/clipping/SNR) lives in `@wake-studio/dsp` (ADR-032) and is
 * re-exported here for call-site compatibility.
 *
 * @see docs/modules/few-shot.md §9
 */

import { peakDbfs, rmsDbfs, isClipped, estimateSnrDb } from '@wake-studio/dsp'

export { peakDbfs, rmsDbfs, isClipped, estimateSnrDb }

/**
 * Cosine similarity between two vectors, rescaled to [0,1].
 *
 * cos(a,b) = dot(a,b) / (||a|| * ||b||), then (cos + 1) / 2 so the existing
 * threshold/min-duration UI (tuned for [0,1] posteriors) works unchanged.
 * Returns 0 if either vector has zero norm (avoid NaN).
 *
 * NOTE: this is the metric used by the WavLM Few-Shot prototype. The PLiX
 * backend uses Euclidean distance instead (see squaredEuclidean / plixScore).
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
 * Squared Euclidean distance between two equal-length vectors.
 * Used by the PLiX backend (Prototypical Network): the prototype is the mean
 * of the support-set embeddings, and a query's score is the (negative) squared
 * distance to that prototype (lower distance = closer = better match).
 * Returns 0 if the vectors differ in length.
 */
export {
  squaredEuclidean,
  plixScore,
  meanPool,
} from '@wake-studio/module-kws-plix'

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
