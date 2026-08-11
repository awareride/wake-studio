/**
 * Few-Shot module - shared types.
 *
 * Public API surface: see docs/modules/few-shot.md §4.
 * WakeWordPrototype is owned by this capability module (ADR-033; moved out of
 * the plix driver so any enrollment/training driver can produce the same
 * artifact type) and re-exported here for callers.
 */

import type { ProvisionPrototypePayload } from '@wake-studio/contracts'
import type { WakeWordPrototype } from './prototype'

export type { WakeWordPrototype }

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

/** A stored wake-word prototype (owned by the few-shot module, ADR-033). */
// (re-exported above)

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
  /** RMS (dBFS) below which a detection window scores 0 (silence gate). */
  silenceFloorDbfs: number
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

/** Serialized form for IndexedDB (Float32Array -> number[]); the contracts
 *  provisioning payload (ADR-033) is the canonical shape. */
export type SerializedPrototype = ProvisionPrototypePayload
