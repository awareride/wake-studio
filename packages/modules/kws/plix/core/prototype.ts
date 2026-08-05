/**
 * kws-plix driver module - Few-Shot scoring types + DSP.
 *
 * Owned by the plix driver: the prototype type and the squared-Euclidean /
 * plixScore rescaling are the encoder's own contract (ADR-024). The Few-Shot
 * module (§6.4) consumes these from here rather than redefining them.
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
