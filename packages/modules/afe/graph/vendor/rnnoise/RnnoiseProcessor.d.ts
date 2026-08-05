import type { RnnoiseWasmModule } from './generated/rnnoise-sync'

/** RNNoise requires exactly 480 float32 samples per frame (10 ms at 48 kHz). */
export declare const RNNOISE_SAMPLE_LENGTH = 480

/**
 * Adaptor around the RNNoise WASM module. Manages WASM memory and exposes
 * frame-by-frame denoising + VAD scoring.
 */
export default class RnnoiseProcessor {
  constructor(wasmInterface: RnnoiseWasmModule)
  /** The PCM sample array size required by RNNoise (always 480). */
  getSampleLength(): number
  /** The PCM sample frequency RNNoise expects (48 kHz). */
  getRequiredPCMFrequency(): number
  /** Release the WASM context. Must be called before discarding. */
  destroy(): void
  /**
   * Process one 480-sample frame. When `shouldDenoise` is true the denoised
   * samples are written back into `pcmFrame` in place. Returns the VAD
   * probability in [0, 1].
   */
  processAudioFrame(pcmFrame: Float32Array, shouldDenoise?: boolean): number
  /** Convenience: VAD score for a frame without overwriting it. */
  calculateAudioFrameVAD(pcmFrame: Float32Array): number
}
