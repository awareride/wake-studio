/**
 * Few-Shot module - shared types.
 *
 * Public API surface: see docs/modules/few-shot.md §4.
 */

/** A single enrolled sample (audio + metadata). */
export interface EnrolledSample {
  id: string
  samples: Float32Array
  sampleRate: number
  embedding: Float32Array
  quality: SampleQuality
  recordedAtMs: number
}

export interface SampleQuality {
  peakDbfs: number
  snrDb: number
  durationMs: number
  clipped: boolean
  acceptable: boolean
}

/** A stored wake-word prototype. */
export interface WakeWordPrototype {
  id: string
  word: string
  vector: Float32Array
  negativeVector?: Float32Array
  sampleIds: string[]
  createdAtMs: number
}

/** Few-Shot configuration (ADR-017 config panel). */
export interface FewShotConfig {
  threshold: number
  minDurationMs: number
  cooldownMs: number
  smoothingWindowFrames: number
  vadGateEnabled: boolean
  vadThreshold: number
  windowMs: number
  hopMs: number
  useNegativePrototype: boolean
}

/** Descriptor for one tunable parameter (shared with AFE/KWS, ADR-017). */
export interface ParameterDescriptor {
  id: string
  label: string
  type: 'number' | 'boolean' | 'select'
  default: number | boolean | string
  min?: number
  max?: number
  step?: number
  options?: ReadonlyArray<{ value: string; label: string }>
  unit?: string
  description: string
}

/** Serialized form for IndexedDB (Float32Array -> number[]). */
export interface SerializedPrototype {
  id: string
  word: string
  vector: number[]
  negativeVector?: number[]
  sampleIds: string[]
  createdAtMs: number
}
