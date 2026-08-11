/**
 * Few-Shot module - prototype serialization bridge (ADR-033).
 *
 * WakeWordPrototype (in-memory, Float32Array) <-> ProvisionPrototypePayload
 * (wire + persistence form, number[]). The payload type is the contracts
 * provisioning contract so any driver (plix enrollment today, a future
 * train-kind driver) can produce/persist the same artifact type.
 */

import type { ProvisionPrototypePayload } from '@wake-studio/contracts'
import type { WakeWordPrototype } from './prototype'

/** Generate a unique id (crypto.randomUUID with fallback). */
export function uid(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/** Serialize a prototype to its wire/persistence payload. */
export function serializePrototype(
  proto: WakeWordPrototype,
): ProvisionPrototypePayload {
  return {
    id: proto.id,
    word: proto.word,
    vector: Array.from(proto.vector),
    negativeVector: proto.negativeVector
      ? Array.from(proto.negativeVector)
      : undefined,
    sampleIds: proto.sampleIds,
    createdAtMs: proto.createdAtMs,
  }
}

/** Deserialize a provisioning payload back into an in-memory prototype. */
export function deserializePrototype(
  s: ProvisionPrototypePayload,
): WakeWordPrototype {
  return {
    id: s.id,
    word: s.word,
    vector: new Float32Array(s.vector),
    negativeVector: s.negativeVector
      ? new Float32Array(s.negativeVector)
      : undefined,
    sampleIds: s.sampleIds,
    createdAtMs: s.createdAtMs,
  }
}
