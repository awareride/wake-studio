/**
 * RNNoise module - web loader sub-entry (pure TS, NO React/UI).
 *
 * Worklet-safe: the AFE graph's AudioWorklet imports this entry to get the
 * synchronous wasm loader + AFEStage adapter, WITHOUT pulling the playground
 * (which is React and must not enter the worklet bundle).
 *
 * Import as `@wake-studio/module-rnnoise/web/loader`.
 */

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
