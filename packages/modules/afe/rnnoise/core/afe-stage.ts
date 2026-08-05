/**
 * RNNoise module - AFEStage adapter (ADR-025).
 *
 * Wraps the headless `RnnoiseModule` in the cross-module `AFEStage` interface
 * so the AFE graph can drive RNNoise as one NS implementation uniformly with
 * AEC/BSS. The adapter is pure TS over the engine - usable in any JS env
 * (web worklet, node, tests). No engine changes.
 */

import type { AFEStage, AFEStageResult } from '@wake-studio/contracts'
import { RnnoiseModule, type RnnoiseConfig } from './engine'
import type { RnnoiseWasmModule } from './wasm-interface'

export class RnnoiseNsStage implements AFEStage {
  readonly kind = 'ns' as const
  private _engine: RnnoiseModule

  constructor(wasm: RnnoiseWasmModule, config?: Partial<RnnoiseConfig>) {
    this._engine = new RnnoiseModule(wasm, config)
  }

  process(frame: Float32Array): AFEStageResult {
    const r = this._engine.processFrame(frame)
    return { vadProbability: r.vadProbability, levelDb: levelDb(frame) }
  }

  reset(): void {
    /* RNNoise state is per-engine; a fresh load resets it. */
  }
}

function levelDb(frame: Float32Array): number {
  let sum = 0
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i]
  const rms = Math.sqrt(sum / Math.max(1, frame.length))
  return rms < 1e-10 ? -120 : 20 * Math.log10(rms)
}
