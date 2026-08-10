/**
 * KWS worker assembly seam (ADR-024 decoupling, direction 1 from #23).
 *
 * The KWS Web Worker is bundled by Vite as a separate file (`?worker`). It
 * calls `createBackend(backendId)` and `createEmbedProvider(...)` from the
 * engine's registry, but the registry is only populated by the driver
 * modules' import-time registration side-effects (`registerKwsBackend` /
 * `registerEmbedProviderFactory`). The worker bundle never imported the
 * drivers, so `createBackend('openwakeword')` threw "Unknown KWS backend"
 * inside the worker (issue #23).
 *
 * This module is the ONE place that wires the drivers into the worker bundle:
 * importing the three driver modules here runs their registration
 * side-effects, and this module is imported by the engine's `KWSEngine` when
 * it creates the worker. The engine core (core/) still never imports a driver
 * module, preserving the ADR-024 rule ("adding a KWS type requires no
 * modification to shared underlying modules") — a new driver only needs to be
 * imported here (or by the host) to become available in the worker.
 *
 * The driver modules are imported as namespaces and their class references are
 * kept alive via `void` statements so Vite cannot tree-shake the side-effect
 * imports out of the production bundle (a bare `import '@pkg'` would be
 * dropped).
 */

// Driver registration side-effects (must run once, before the worker boots).
import * as openWakeWordDriver from '@wake-studio/module-kws-openwakeword'
import * as sherpaDriver from '@wake-studio/module-kws-sherpa'
import * as plixDriver from '@wake-studio/module-kws-plix'
import * as streamingDriver from '@wake-studio/module-kws-streaming'

// Keep the namespace imports live: their modules register backends on import.
void openWakeWordDriver.OpenWakeWordBackend
void sherpaDriver.SherpaOnnxKwsBackend
void plixDriver.PlixKwsBackend
void streamingDriver.KWSStreamingBackend

// The worker itself (Vite `?worker` bundles it as a separate file).
import KWSWorker from './worker?worker'

export { KWSWorker }

/**
 * Create a KWS Web Worker with all driver backends registered in its bundle.
 *
 * The host app never imports the drivers itself (main.tsx historically did,
 * which is why the main-thread registry worked but the worker's did not).
 * Creating the worker through this seam is the only requirement for driver
 * registration inside the worker.
 */
export function createKwsWorker(): Worker {
  return new KWSWorker()
}
