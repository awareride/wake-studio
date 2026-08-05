/**
 * Few-Shot module - web target.
 *
 * Re-exports the engine and exposes the recorder AudioWorklet URL.
 */

export { FewShotEngine } from '../core'
export { DEFAULT_CONFIG, describeParameters } from '../core'
export type { FewShotConfig, EnrolledSample } from '../core'

// The recorder worklet, bundled by Vite via `?worker&url` (AudioWorklet).
export { default as recorderWorkletUrl } from './recorder.worklet.ts?worker&url'
