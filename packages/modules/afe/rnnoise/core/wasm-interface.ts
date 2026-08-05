/**
 * RNNoise wasm interface (portable type, target-agnostic).
 *
 * The emscripten glue produces an object with these exports. Web (vendored
 * base64 glue) and Node (native path) both conform to this shape, so the core
 * engine never imports environment-specific code.
 */

export interface RnnoiseWasmModule {
  _malloc(size: number): number
  _free(ptr: number): void
  _rnnoise_create(): number
  _rnnoise_destroy(ctx: number): void
  /** Returns the VAD probability [0,1]. Input and output may alias. */
  _rnnoise_process_frame(ctx: number, inputPtr: number, outputPtr: number): number
  HEAPF32: Float32Array
}

export type RnnoiseWasmModuleFactory = (moduleArg?: object) => RnnoiseWasmModule
