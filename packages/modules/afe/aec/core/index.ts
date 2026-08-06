/**
 * AEC stage module - core (ADR-001/016).
 *
 * v1 is passthrough (WebRTC AEC3 deferred to v1.x). Exposes the AFEStage
 * interface so the AFE graph drives it uniformly; future implementations
 * (WebRTC AEC3) can replace the passthrough behind the same contract.
 */

import type { AFEStage, AFEStageKind, AFEStageResult } from '@wake-studio/contracts'
import { levelDb } from '@wake-studio/dsp'

export interface AecConfig {
  /** Passthrough for v1; kept as a flag so the panel is honest. */
  bypass: boolean
}

export class AecStage implements AFEStage {
  readonly kind: AFEStageKind = 'aec'
  private _config: AecConfig

  constructor(config: Partial<AecConfig> = {}) {
    this._config = { bypass: true, ...config }
  }

  get config(): AecConfig {
    return { ...this._config }
  }

  setConfig(patch: Partial<AecConfig>): void {
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
