/**
 * KWS backend registry (ADR-020) - engine module.
 *
 * Maps a {@link KWSBackendId} to a factory. The engine module does NOT hard-code
 * driver implementations: each driver module (openwakeword / sherpa / plix)
 * registers itself via the `registerKwsBackend` seam (ADR-024 decoupling rule).
 *
 * @see docs/modules/kws.md §4 (KWSBackend), §6 (backend config)
 */

import type {
  KWSBackend,
  KWSBackendId,
  KWSBackendCategory,
  BackendModelUrls,
} from './types'
import type { ModuleSpec } from '@wake-studio/contracts'

/** A registry entry for a KWS backend. */
export interface KWSBackendRegistration {
  id: KWSBackendId
  label: string
  /**
   * KWS functional category (ADR-024 §2): 'traditional' | 'asr-decoding' |
   * 'few-shot'. Hosts branch on this (e.g. enrollment flow for few-shot)
   * instead of on backend ids, so a new few-shot driver gets the shared
   * enrollment UI without touching the host. Defaults to 'traditional'.
   */
  category: KWSBackendCategory
  /**
   * Factory: create a backend instance. Throws if the backend has no
   * browser-feasible adapter yet.
   */
  create: () => KWSBackend
  /** Whether this backend is browser-feasible (selectable in the PWA demo). */
  browserFeasible: boolean
  /** One-line note shown in the config panel for non-feasible backends. */
  availabilityNote: string
  /**
   * The driver module's own spec (ADR-025). Carried so hosts (web panel,
   * console) can render the driver's params/actions automatically from the
   * registry - no hard-coded per-backend cases in the host.
   */
  spec?: ModuleSpec
  /**
   * Optional: does this backend have the model URLs it needs to load?
   *
   * Each driver needs a different URL subset of {@link BackendModelUrls}, and
   * the worker must not hard-code per-backend cases (ADR-024). A driver that
   * omits this is assumed to need the openwakeword triple (the historical
   * default).
   */
  hasRequiredUrls?: (urls: BackendModelUrls) => boolean
  /**
   * Optional: a main-thread-only backend factory (e.g. sherpa-onnx-kws runs
   * on the main thread - its classic emscripten wasm needs DOM, ADR-018).
   * When set, the engine drives this backend on the main thread instead of
   * the worker. The returned backend must expose a `configure(config)`.
   */
  mainThreadFactory?: () => KWSBackend
}

/** The backend registry. Drivers register into this array. */
const REGISTRY: KWSBackendRegistration[] = []

/** Register a backend (called by driver modules at import time). */
export function registerKwsBackend(registration: KWSBackendRegistration): void {
  if (REGISTRY.some((r) => r.id === registration.id)) return
  REGISTRY.push(registration)
}

/** Read-only view of all registrations. */
export function getBackendRegistry(): ReadonlyArray<KWSBackendRegistration> {
  return REGISTRY
}

/** Look up a registration by id. */
export function getBackendRegistration(
  id: KWSBackendId,
): KWSBackendRegistration | undefined {
  return REGISTRY.find((r) => r.id === id)
}

/** Create a backend instance for the given id. Throws if infeasible. */
export function createBackend(id: KWSBackendId): KWSBackend {
  const reg = getBackendRegistration(id)
  if (!reg) {
    throw new Error(`Unknown KWS backend: ${id}`)
  }
  return reg.create()
}

/**
 * Create a main-thread-only backend (e.g. sherpa-onnx-kws). Returns null when
 * the backend has no mainThreadFactory (it runs in the worker instead).
 */
export function createMainThreadBackend(
  id: KWSBackendId,
): KWSBackend | null {
  const reg = getBackendRegistration(id)
  if (!reg?.mainThreadFactory) return null
  return reg.mainThreadFactory()
}

/**
 * Does the registered backend have the model URLs it needs?
 *
 * Drivers declare this via `hasRequiredUrls` so adding a backend with a new
 * URL shape never edits the worker (ADR-024). The fallback is the openwakeword
 * triple, which is what every pre-`hasRequiredUrls` driver expected.
 */
export function backendHasRequiredUrls(
  id: KWSBackendId,
  urls: BackendModelUrls,
): boolean {
  const reg = getBackendRegistration(id)
  if (reg?.hasRequiredUrls) return reg.hasRequiredUrls(urls)
  return Boolean(urls.melspectrogram && urls.embedding && urls.classifier)
}

// ---------------------------------------------------------------------------
// Embed-provider seam (Few-Shot, Phase 3).
// The plix driver registers an EmbedProvider factory so the worker can host
// the embed() scaffold without importing the plix module directly (ADR-024).
// ---------------------------------------------------------------------------

export interface EmbedProviderFactory {
  (url: string, runtime: string): Promise<unknown>
}

let embedProviderFactory: EmbedProviderFactory | null = null

/** Register the embed-provider factory (called by the plix driver). */
export function registerEmbedProviderFactory(
  factory: EmbedProviderFactory,
): void {
  embedProviderFactory = factory
}

/** Create an embed provider (or null if no driver registered one). */
export async function createEmbedProvider(
  url: string,
  runtime: string,
): Promise<unknown> {
  if (!embedProviderFactory) return null
  return embedProviderFactory(url, runtime)
}
