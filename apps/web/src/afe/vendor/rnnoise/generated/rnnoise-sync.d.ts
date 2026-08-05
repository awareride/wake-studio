// Minimal types for the vendored emscripten synchronous WASM loader.
// (Upstream ships @types/emscripten-dependent types; we avoid that dev-dependency
// and declare only the RNNoise surface we use.)
export interface RnnoiseWasmModule {
  _malloc(size: number): number
  _free(ptr: number): void
  _rnnoise_create(): number
  _rnnoise_destroy(ctx: number): void
  /** Returns the VAD probability [0,1]. Input and output may alias. */
  _rnnoise_process_frame(ctx: number, inputPtr: number, outputPtr: number): number
  HEAPF32: Float32Array
}

export default function createRNNWasmModuleSync(moduleArg?: object): RnnoiseWasmModule
