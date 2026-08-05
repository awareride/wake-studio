/**
 * RNNoise module - web target (browser).
 *
 * Loads the vendored emscripten glue (wasm embedded as base64) and exposes
 * the module's browser entrypoints: `loadRnnoise` (async loader) and the
 * playground component.
 */

import createRNNWasmModuleSync from './vendor/generated/rnnoise-sync'
import { RnnoiseModule, type RnnoiseConfig } from '../core'

export { RnnoiseModule } from '../core'
export type { RnnoiseConfig, RnnoiseFrameResult } from '../core'

/** Load the vendored RNNoise wasm and return a ready engine. */
export function loadRnnoise(config?: Partial<RnnoiseConfig>): RnnoiseModule {
  // The vendored glue is synchronous (wasm embedded as base64) - no async.
  const wasm = createRNNWasmModuleSync()
  return new RnnoiseModule(wasm, config)
}

export { default as RnnoisePlayground } from './playground'
