/**
 * RNNoise module - web loader sub-entry (pure TS, NO React/UI).
 *
 * Worklet-safe: the AFE graph's AudioWorklet imports this entry to get the
 * synchronous wasm loader + AFEStage adapter, WITHOUT pulling the playground
 * (which is React and must not enter the worklet bundle).
 *
 * Import as `@wake-studio/module-rnnoise/web/loader`.
 */

// Side-effect polyfills for the AudioWorkletGlobalScope: the vendored RNNoise
// wasm glue (generated/rnnoise-sync.js) calls bare `atob()` and reads
// `self.location.href`, neither of which exists inside a worklet. polyfills.js
// installs `globalThis.atob` + `globalThis.self.location` - import it FIRST so
// the glue resolves them at instantiation time.
import './vendor/polyfills'

import createRNNWasmModuleSync from './vendor/generated/rnnoise-sync'
import { RnnoiseNsStage, type RnnoiseConfig } from '../core'

export { RnnoiseNsStage } from '../core'
export type { RnnoiseConfig, RnnoiseFrameResult } from '../core'

/** Load RNNoise wrapped in the AFEStage interface (worklet-safe). */
export function loadRnnoiseStage(
  config?: Partial<RnnoiseConfig>,
): RnnoiseNsStage {
  return new RnnoiseNsStage(createRNNWasmModuleSync(), config)
}
