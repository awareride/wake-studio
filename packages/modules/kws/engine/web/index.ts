/**
 * KWS engine module - web target.
 *
 * Re-exports the engine and exposes the Web Worker URL (Vite `?worker`).
 */

export { KWSEngine } from '../core'
export { DEFAULT_CONFIG, describeParameters } from '../core'
export type { KWSConfig, KWSBackend, KWSBackendId } from '../core'

// The worker is bundled by Vite via `?worker`; re-exported for callers that
// need the worker constructor (the engine imports it internally).
export { default as KWSWorker } from './worker?worker'

// Worker assembly seam (ADR-024, issue #23): imports the driver modules so
// their registration side-effects run inside the worker bundle. Hosts that
// construct the worker via `createKwsWorker()` get all registered backends.
export { createKwsWorker } from './worker-assembly'
