/**
 * KWS worker assembly seam (ADR-024/034 decoupling, #23).
 *
 * The KWS Web Worker is bundled by Vite as a separate file (`?worker`). It
 * calls `createBackend(backendId)` and `createEmbedProvider(...)` from the
 * engine's registry, but the registry is only populated by the driver
 * modules' import-time registration side-effects (`registerKwsBackend` /
 * `registerEmbedProviderFactory`). The worker composition root
 * (web/worker-wire.ts) imports the drivers INTO the worker bundle, so
 * `createBackend('openwakeword')` works inside the worker (issue #23).
 *
 * This module ONLY creates the worker; it imports no driver modules itself
 * (ADR-034: impl modules are imported only by a wire). The engine core
 * (core/) still never imports a driver module, preserving the ADR-024 rule
 * ("adding a KWS type requires no modification to shared underlying modules")
 * - a new driver only needs its spec; the wire regenerates.
 */

// The worker itself (Vite `?worker` bundles it as a separate file).
import KWSWorker from './worker?worker'

export { KWSWorker }

/**
 * Create a KWS Web Worker with all driver backends registered in its bundle.
 *
 * The worker bundle gets its driver registrations from the worker wire
 * (web/worker-wire.ts, imported at the top of worker.ts). The host app's
 * driver registrations come from the host wire (apps/web/src/module-wire.ts),
 * so neither bundle relies on this module importing drivers.
 */
export function createKwsWorker(): Worker {
  return new KWSWorker()
}
