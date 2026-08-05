/**
 * AFE graph module - web target (browser).
 *
 * The pipeline AudioWorklet lives here (with its vendored RNNoise copy), and
 * the main-thread AFEPipeline controller is re-exported from core. The
 * `?worker&url` worklet import is Vite-specific; the worklet file itself is
 * module-local so any bundler (or the vite middleware) can resolve it.
 */

export { AFEPipeline } from '../core'
export { DEFAULT_CONFIG, describeParameters } from '../core'

// The worklet is imported by the controller via `?worker&url` (Vite); keep a
// stable re-export for bundlers that need the path string.
export { default as pipelineWorkletUrl } from './pipeline-processor.worklet.ts?worker&url'
