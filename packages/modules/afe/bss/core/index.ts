/**
 * BSS stage module - core (ADR-001/016).
 *
 * v1 is single-mic passthrough (true BSS is device-side in exported demos,
 * ADR-003). Exposes the AFEStage interface; a 2-mic beamforming approximation
 * can replace it later behind the same contract.
 */

import type { AFEStage, AFEStageKind, AFEStageResult } from '@wake-studio/contracts'

export interface BssConfig {
  /** Single-mic passthrough for v1. */
  bypass: boolean
}

export class BssStage implements AFEStage {
  readonly kind: AFEStageKind = 'bss'
  private _config: BssConfig

  constructor(config: Partial<BssConfig> = {}) {
    this._config = { bypass: true, ...config }
  }

  get config(): BssConfig {
    return { ...this._config }
  }

  setConfig(patch: Partial<BssConfig>): void {
    this._config = { ...this._config, ...patch }
  }

  /** Passthrough for v1: the frame is returned untouched. */
  process(frame: Float32Array): AFEStageResult {
    return { vadProbability: 0, levelDb: levelDb(frame) }
  }

  reset(): void {
    /* no state in the passthrough implementation */
  }
}

function levelDb(frame: Float32Array): number {
  let sum = 0
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i]
  const rms = Math.sqrt(sum / Math.max(1, frame.length))
  return rms < 1e-10 ? -120 : 20 * Math.log10(rms)
}
