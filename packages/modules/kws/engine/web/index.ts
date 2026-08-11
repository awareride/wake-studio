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

// Worker assembly seam (ADR-024/034, issue #23): creates the KWS worker. The
// worker bundle gets its driver registrations from the worker composition
// root (web/worker-wire.ts, generated); hosts that construct the worker via
// `createKwsWorker()` get all registered backends.
export { createKwsWorker } from './worker-assembly'
