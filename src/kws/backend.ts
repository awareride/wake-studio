/**
 * KWS backend registry (ADR-020).
 *
 * Maps a {@link KWSBackendId} to a factory. Only browser-feasible backends have
 * a real factory in v1; the others are listed so the config panel can show the
 * roadmap and so the device-side SDK (ADR-021) can reuse the same identifiers.
 *
 * @see docs/modules/kws.md §4 (KWSBackend), §6 (backend config)
 */

import type { KWSBackend, KWSBackendId } from './types'
import { OpenWakeWordBackend } from './backends/openwakeword'

/** A registry entry for a KWS backend. */
export interface KWSBackendRegistration {
  id: KWSBackendId
  label: string
  /**
   * Factory: create a backend instance. Throws if the backend has no
   * browser-feasible adapter yet.
   */
  create: () => KWSBackend
  /** Whether this backend is browser-feasible (selectable in the PWA demo). */
  browserFeasible: boolean
  /** One-line note shown in the config panel for non-feasible backends. */
  availabilityNote: string
}

/**
 * The backend registry. Add new browser adapters here as they land
 * (e.g. PocketSphinx WASM, PLiX Few-Shot detection).
 */
export const BACKEND_REGISTRY: ReadonlyArray<KWSBackendRegistration> = [
  {
    id: 'openwakeword',
    label: 'OpenWakeWord (mel -> embedding -> classifier)',
    create: () => new OpenWakeWordBackend(),
    browserFeasible: true,
    availabilityNote: 'Available',
  },
  {
    id: 'microwakeword',
    label: 'micro-wake-word (TFLite-Micro)',
    create: () => {
      throw new Error(
        'micro-wake-word is not browser-feasible (TFLite-Micro / MCU). It is an export-only backend (ADR-021).',
      )
    },
    browserFeasible: false,
    availabilityNote: 'MCU / export-only (Phase 5)',
  },
  {
    id: 'plixkws',
    label: 'PLiX Few-Shot (prototype distance)',
    create: () => {
      throw new Error(
        'PLiX Few-Shot is created directly by the worker (needs a shared embedProvider + prototype). See worker.ts handleLoad.',
      )
    },
    browserFeasible: true,
    availabilityNote: 'Phase 3 (enrollment required)',
  },
  {
    id: 'pocketsphinx',
    label: 'PocketSphinx (HMM/GMM)',
    create: () => {
      throw new Error(
        'PocketSphinx browser adapter (WASM port) is not yet implemented.',
      )
    },
    browserFeasible: false,
    availabilityNote: 'Pending (WASM port)',
  },
]

/** Look up a registration by id. */
export function getBackendRegistration(
  id: KWSBackendId,
): KWSBackendRegistration | undefined {
  return BACKEND_REGISTRY.find((r) => r.id === id)
}

/** Create a backend instance for the given id. Throws if infeasible. */
export function createBackend(id: KWSBackendId): KWSBackend {
  const reg = getBackendRegistration(id)
  if (!reg) {
    throw new Error(`Unknown KWS backend: ${id}`)
  }
  return reg.create()
}
