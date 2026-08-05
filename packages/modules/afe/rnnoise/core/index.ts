/**
 * RNNoise module - portable core (ADR-025 pilot).
 *
 * This directory is shared by ALL targets: the web app (wasm loader), the
 * local service (node impl), and tests. It contains:
 *   - the engine facade `RnnoiseModule` (frame-in/out + VAD),
 *   - the wasm interface types (RnnoiseWasmModule),
 *   - pure DSP helpers usable headlessly.
 *
 * The emscripten glue itself lives per-target: `web/vendor/` (base64-embedded
 * wasm) and `node/` (native path). This core only talks to a `RnnoiseWasmModule`
 * interface, so every target can provide its own.
 */

export { RNNOISE_FRAME_SIZE, vadToProbability, frameRms, applyGain } from './dsp'
export type { RnnoiseWasmModule, RnnoiseWasmModuleFactory } from './wasm-interface'
export {
  RnnoiseModule,
  type RnnoiseFrameResult,
  type RnnoiseConfig,
} from './engine'
export { RnnoiseNsStage } from './afe-stage'
