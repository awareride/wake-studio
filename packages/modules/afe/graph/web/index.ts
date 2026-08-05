/**
 * AFE graph module - web target (browser).
 *
 * The pipeline AudioWorklet lives here and **drives the stage modules**
 * (AEC/BSS/NS) through the AFEStage interface - it owns only the scheduling,
 * not the stage DSP. The `?worker&url` worklet import is Vite-specific.
 */

export { AFEPipeline } from '../core'
export { DEFAULT_CONFIG, describeParameters } from '../core'

// The worklet is imported by the controller via `?worker&url` (Vite); keep a
// stable re-export for bundlers that need the path string.
export { default as pipelineWorkletUrl } from './pipeline-processor.worklet.ts?worker&url'
