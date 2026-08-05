/**
 * Ambient type declarations for the vendored RNNoise glue (ADR-016/025).
 *
 * The vendored files under vendor/rnnoise/ are plain JS with sibling .d.ts
 * files; TS sometimes fails to associate them with relative imports in a
 * module context. These `declare module` entries provide the module surface
 * for the worklet's imports regardless of resolution quirks.
 */

declare module '*polyfills' {
  const polyfills: unknown
  export default polyfills
}

declare module '*RnnoiseProcessor' {
  import type { RnnoiseWasmModule } from './vendor/rnnoise/generated/rnnoise-sync'
  export default class RnnoiseProcessor {
    constructor(wasmInterface: RnnoiseWasmModule)
    getSampleLength(): number
    getRequiredPCMFrequency(): number
    destroy(): void
    processAudioFrame(pcmFrame: Float32Array, shouldDenoise?: boolean): number
    calculateAudioFrameVAD(pcmFrame: Float32Array): number
  }
}

declare module '*rnnoise-sync' {
  export interface RnnoiseWasmModule {
    _malloc(size: number): number
    _free(ptr: number): void
    _rnnoise_create(): number
    _rnnoise_destroy(ctx: number): void
    _rnnoise_process_frame(ctx: number, inputPtr: number, outputPtr: number): number
    HEAPF32: Float32Array
  }
  export default function createRNNWasmModuleSync(moduleArg?: object): RnnoiseWasmModule
}
