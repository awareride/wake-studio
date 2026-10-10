/**
 * RNNoise module - AFEStage adapter (ADR-025).
 *
 * Wraps the headless `RnnoiseModule` in the cross-module `AFEStage` interface
 * so the AFE graph can drive RNNoise as one NS implementation uniformly with
 * AEC/BSS. The adapter is pure TS over the engine - usable in any JS env
 * (web worklet, node, tests). No engine changes.
 */

import type { AFEStage, AFEStageParams, AFEStageResult } from '@wake-studio/contracts'
import { levelDb } from '@wake-studio/dsp'
import { RnnoiseModule, type RnnoiseConfig } from './engine'
import type { RnnoiseWasmModule } from './wasm-interface'

export class RnnoiseNsStage implements AFEStage {
  readonly kind = 'ns' as const
  private _engine: RnnoiseModule

  constructor(wasm: RnnoiseWasmModule, config?: Partial<RnnoiseConfig>) {
    this._engine = new RnnoiseModule(wasm, config)
  }

  /**
   * The engine's live configuration. Exposed so tests (and the playground) can
   * assert that a delivered param actually landed, rather than assuming it did.
   */
  get engineConfig(): RnnoiseConfig {
    return this._engine.config
  }

  process(frame: Float32Array): AFEStageResult {
    const r = this._engine.processFrame(frame)
    return { vadProbability: r.vadProbability, levelDb: levelDb(frame) }
  }

  reset(): void {
    /* RNNoise state is per-engine; a fresh load resets it. */
  }

  /**
   * Apply runtime parameters (issue #243) — `strength` and `denoiseEnabled`
   * from this module's `module.spec.json`.
   *
   * Unknown keys are ignored rather than throwing: this can run inside an
   * AudioWorklet callback, where an exception would tear down the audio
   * thread. Range clamping happens in the engine (`strength` is clamped to
   * 0..1), and the main thread has already validated against the spec.
   */
  configure(params: AFEStageParams): void {
    const { strength, denoiseEnabled } = params as Partial<RnnoiseConfig>
    const patch: Partial<RnnoiseConfig> = {}
    if (typeof strength === 'number') patch.strength = strength
    if (typeof denoiseEnabled === 'boolean') patch.denoiseEnabled = denoiseEnabled
    if (Object.keys(patch).length > 0) {
      this._engine.setConfig(patch)
    }
  }
}
