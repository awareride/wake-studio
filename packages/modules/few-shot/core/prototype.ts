/**
 * Few-Shot module - wake-word prototype type + scoring primitives (ADR-033).
 *
 * Owned by the few-shot capability module, NOT by any KWS driver: the
 * prototype type and the squared-Euclidean / plixScore rescaling are the
 * enrollment contract, and a future `train`-kind driver (openwakeword
 * training, ADR-033) must produce the same artifact type without importing an
 * impl module (#74 rule). The plix driver imports these from here.
 *
 * @see docs/modules/few-shot.md §4-§5
 */

/** A stored wake-word prototype (Few-Shot enrollment output). */
export interface WakeWordPrototype {
  id: string
  word: string
  vector: Float32Array
  negativeVector?: Float32Array
  sampleIds: string[]
  createdAtMs: number
}

/** Squared Euclidean distance between two equal-length vectors. */
export function squaredEuclidean(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) return 0
  let sum = 0
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i]
    sum += d * d
  }
  return sum
}

/**
 * L2-normalize a vector to unit norm (in place-safe: returns a new array).
 *
 * Required by the few-shot scoring: the PLiX encoder emits RAW GAP embeddings
 * with L2 norm ~4-5, so an un-normalized squared-Euclidean distance is large
 * even for a near-perfect match (cosine 0.92 -> d^2 ~3-4 -> score ~0.24),
 * making the 1/(1+d^2) score unreachable for any threshold (issue #66).
 * Normalizing both operands first bounds d^2 = 2(1-cos) to [0,4], which is
 * the cosine similarity the technical reference specifies. Zero vectors are
 * returned unchanged (avoid NaN).
 */
export function l2Normalize(v: Float32Array): Float32Array {
  let sum = 0
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i]
  const norm = Math.sqrt(sum)
  if (!Number.isFinite(norm) || norm === 0) return v
  const out = new Float32Array(v.length)
  for (let i = 0; i < v.length; i++) out[i] = v[i] / norm
  return out
}

/**
 * Rescale a squared-Euclidean distance to a [0,1] similarity score:
 *     score = 1 / (1 + d^2)
 * Mirrors PLiX's framing (negative squared distance as a softmax logit)
 * mapped into [0,1] so the threshold/min-duration trigger UI works unchanged.
 */
export function plixScore(squaredDistance: number): number {
  if (!Number.isFinite(squaredDistance) || squaredDistance < 0) return 0
  return 1 / (1 + squaredDistance)
}

/** Mean-pool embeddings into a prototype vector. */
export function meanPool(embeddings: Float32Array[]): Float32Array {
  if (embeddings.length === 0) return new Float32Array(0)
  const dim = embeddings[0].length
  const out = new Float32Array(dim)
  for (const e of embeddings) {
    for (let i = 0; i < dim; i++) out[i] += e[i]
  }
  for (let i = 0; i < dim; i++) out[i] /= embeddings.length
  return out
}
