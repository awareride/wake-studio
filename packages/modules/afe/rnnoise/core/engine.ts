/**
 * RNNoise module - engine facade (headless, target-agnostic).
 *
 * `RnnoiseModule` wraps any `RnnoiseWasmModule` and exposes the module's
 * public contract (docs/module-spec.md §interfaces): `denoiseFrame` +
 * `vadProbability`. Both the web target (vendored glue) and the node target
 * (native path) construct this engine; tests (L2) construct it in Node.
 */

import type { RnnoiseWasmModule } from './wasm-interface'
import { RNNOISE_FRAME_SIZE } from './constants'

export interface RnnoiseConfig {
  /**
   * Wet/dry mix between the original and the denoised signal: 0 = bypass
   * (original untouched), 1 = full RNNoise output (default).
   *
   * RNNoise itself has no strength/aggressiveness parameter, so this is a
   * post-blend, not a model setting. It exists because a fixed-strength
   * denoiser can distort wake-word onsets; letting the user pull back toward
   * the dry signal trades noise reduction for waveform fidelity.
   */
  strength: number
  /** Whether to denoise frames in place. */
  denoiseEnabled: boolean
}

export interface RnnoiseFrameResult {
  /** VAD probability in [0, 1]. */
  vadProbability: number
  /** Whether the frame was denoised in place. */
  denoised: boolean
}

/**
 * The emscripten heap keeps the RNNoise DenoiseState + emmalloc free-list in
 * the lower/middle region. Writing our frame buffer there overlaps the
 * free-list metadata on the SECOND process_frame call and `_free` crashes
 * with "memory access out of bounds". We therefore use a fixed region at the
 * TAIL of the heap (far from the state block) and never free it; the wasm
 * instance is single-use anyway (one engine per module load).
 */
const TAIL_RESERVE_FLOATS = 1024

export class RnnoiseModule {
  private _wasm: RnnoiseWasmModule
  private _ctx: number
  /** Byte pointer into the static tail region (never malloc'd/freed). */
  private _bufPtr: number
  private _config: RnnoiseConfig
  /** Copy of the input frame, kept for the `strength` wet/dry blend. */
  private _orig: Float32Array

  constructor(wasm: RnnoiseWasmModule, config: Partial<RnnoiseConfig> = {}) {
    this._wasm = wasm
    // Reserve a fixed region at the heap tail, far from the DenoiseState block.
    this._bufPtr = (wasm.HEAPF32.length - TAIL_RESERVE_FLOATS) << 2
    this._ctx = wasm._rnnoise_create()
    this._config = {
      strength: 1,
      denoiseEnabled: true,
      ...config,
    }
    this._orig = new Float32Array(RNNOISE_FRAME_SIZE)
  }

  get config(): RnnoiseConfig {
    return { ...this._config }
  }

  setConfig(patch: Partial<RnnoiseConfig>): void {
    this._config = { ...this._config, ...patch }
  }

  /**
   * Process one 480-sample frame. When `denoiseEnabled`, the frame is denoised
   * in place; the VAD probability is always returned.
   */
  processFrame(frame: Float32Array): RnnoiseFrameResult {
    if (frame.length !== RNNOISE_FRAME_SIZE) {
      throw new Error(
        `RNNoise requires exactly ${RNNOISE_FRAME_SIZE} samples per frame, got ${frame.length}`,
      )
    }
    const { HEAPF32 } = this._wasm
    const bufF32 = this._bufPtr >> 2
    const denoised = this._config.denoiseEnabled
    // `strength` is a wet/dry mix, so keep the dry signal when blending.
    const strength = Math.min(1, Math.max(0, this._config.strength))
    const blend = denoised && strength < 1
    if (blend) {
      this._orig.set(frame)
    }
    // Copy into the wasm buffer (rnnoise works on 16-bit-scaled floats).
    for (let i = 0; i < RNNOISE_FRAME_SIZE; i++) {
      HEAPF32[bufF32 + i] = frame[i] * 32768
    }
    // Same buffer in/out - required for the VAD return value (jitsi convention).
    const vad = this._wasm._rnnoise_process_frame(
      this._ctx,
      this._bufPtr,
      this._bufPtr,
    )
    if (denoised) {
      if (blend) {
        const dry = 1 - strength
        for (let i = 0; i < RNNOISE_FRAME_SIZE; i++) {
          frame[i] =
            this._orig[i] * dry + (HEAPF32[bufF32 + i] / 32768) * strength
        }
      } else {
        for (let i = 0; i < RNNOISE_FRAME_SIZE; i++) {
          frame[i] = HEAPF32[bufF32 + i] / 32768
        }
      }
    }
    return { vadProbability: vad, denoised }
  }

  /** Convenience: VAD only, no in-place modification. */
  vadForFrame(frame: Float32Array): number {
    return this.processFrame(frame).vadProbability
  }

  destroy(): void {
    // The tail buffer is static (never malloc'd); only destroy the context.
    this._wasm._rnnoise_destroy(this._ctx)
  }
}
