/**
 * BSS stage module - core (ADR-001/016).
 *
 * v1 is single-mic passthrough (true BSS is device-side in exported demos,
 * ADR-003). Exposes the AFEStage interface; a 2-mic beamforming approximation
 * can replace it later behind the same contract.
 */

import type { AFEStage, AFEStageKind, AFEStageResult, AFEStageGeometry } from '@wake-studio/contracts'
import { MONO_STAGE_GEOMETRY } from '@wake-studio/contracts'
import { levelDb } from '@wake-studio/dsp'

export interface BssConfig {
  /** Single-mic passthrough for v1. */
  bypass: boolean
}

export class BssStage implements AFEStage {
  readonly kind: AFEStageKind = 'bss'
  /**
   * Declared geometry (issue #245): v1 is single-mic passthrough, so 1/1/0.
   * A beamforming implementation declaring `inputChannels > 1` is spatial and
   * may only run on a capture qualified by #246; the capability it declares
   * (`fixed_delay_and_sum` / `doa_steered` / `mvdr_gsc`, ADR-048 §7) is a
   * beamformer, never blind source separation.
   */
  readonly geometry: AFEStageGeometry = MONO_STAGE_GEOMETRY
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
