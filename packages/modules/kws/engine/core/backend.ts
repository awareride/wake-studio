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
  BackendModelResolveContext,
  BackendResourceDescriptor,
  ModelSourceRole,
  ProvisionCapability,
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
   * Model-source roles this backend consumes (ADR-024). The host renders the
   * Model-source editor from this; a backend that bundles its model (e.g.
   * sherpa's wasm package) declares none. Defaults to [].
   */
  modelRoles?: ModelSourceRole[]
  /**
   * Resolve this backend's model URLs (ADR-011/024) from the user's model
   * sources + driver params. Backends own their URL mapping, so the host
   * never branches per backend id. Omitted for backends that load no model
   * URLs (e.g. sherpa bundles its model in the wasm package).
   */
  resolveModelUrls?: (
    ctx: BackendModelResolveContext,
  ) => BackendModelUrls | Promise<BackendModelUrls>
  /**
   * Resource rows for the host's Engine card (models + persistent data).
   * Declared per driver (ADR-024); the host renders them generically.
   * Defaults to [].
   */
  resources?: BackendResourceDescriptor[]
  /**
   * Optional provisioning capability (ADR-033): how this backend produces the
   * wake-word artifact it loads with (enrolled prototype / keyword list /
   * trained classifier). The host renders the capability's spec, collects
   * input, calls produce(), persists the artifact, then feeds apply() into
   * engine.load. Omitted for backends that load plain pretrained models.
   */
  provision?: ProvisionCapability
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

/**
 * Resolve one model role's URL from the user's selection, honoring:
 *  - a user-library model ('user:<id>') -> its pre-resolved blob URL
 *  - a registry model id -> the registry's URL for that id
 *  - 'custom' -> the user-supplied custom URL
 *  - nothing selected -> the built-in registry entry for `fallbackId`
 *
 * Shared by drivers that consume registry-backed model roles, so the
 * selection semantics live in ONE place (ADR-024).
 */
export function resolveRoleUrl(
  ctx: BackendModelResolveContext,
  role: string,
  fallbackId: string,
): string | undefined {
  const selected = ctx.modelSources[role]
  const byId = new Map(ctx.registry.models.map((m) => [m.id, m.url]))
  if (selected?.startsWith('user:')) return ctx.userBlobUrls[role]
  if (selected && selected !== 'custom') return byId.get(selected)
  if (selected === 'custom') return ctx.customUrls[role]?.trim() || undefined
  return byId.get(fallbackId)
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
/**
 * Which key of {@link BackendModelUrls} the registered embed provider reads
 * its encoder URL from (ADR-034). The URL bag is driver-opaque, so the
 * worker cannot assume a plix-named key - the driver declares it here.
 */
let embedProviderUrlKey: string | undefined

/**
 * Register the embed-provider factory (called by the plix driver).
 *
 * @param urlKey the BackendModelUrls key the embed encoder URL lives under
 *   (e.g. 'plixkws'); the worker boots the embed provider from `urls[urlKey]`.
 */
export function registerEmbedProviderFactory(
  factory: EmbedProviderFactory,
  opts?: { urlKey?: string },
): void {
  embedProviderFactory = factory
  embedProviderUrlKey = opts?.urlKey
}

/** The BackendModelUrls key the embed encoder URL lives under, if any. */
export function getEmbedProviderUrlKey(): string | undefined {
  return embedProviderUrlKey
}

/** Create an embed provider (or null if no driver registered one). */
export async function createEmbedProvider(
  url: string,
  runtime: string,
): Promise<unknown> {
  if (!embedProviderFactory) return null
  return embedProviderFactory(url, runtime)
}
