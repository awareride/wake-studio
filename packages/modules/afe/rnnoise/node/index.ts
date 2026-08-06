/**
 * RNNoise module - node target (studio backend).
 *
 * The vendored emscripten glue supports ENVIRONMENT_IS_NODE, so the studio
 * backend can run the SAME wasm artifact as the browser. This keeps web and
 * backend behavior byte-identical (the point of the L2 test too).
 */

import createRNNWasmModuleSync from '../web/vendor/generated/rnnoise-sync'
import { RnnoiseModule, type RnnoiseConfig } from '../core'

export { RnnoiseModule } from '../core'
export type { RnnoiseConfig, RnnoiseFrameResult } from '../core'

/** Node-native loader (same glue; ENVIRONMENT_IS_NODE path is taken). */
export function loadRnnoiseNode(config?: Partial<RnnoiseConfig>): RnnoiseModule {
  const wasm = createRNNWasmModuleSync()
  return new RnnoiseModule(wasm, config)
}
