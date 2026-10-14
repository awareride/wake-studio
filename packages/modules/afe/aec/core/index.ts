/**
 * AEC stage module - core (ADR-001/016).
 *
 * v1 is passthrough (WebRTC AEC3 deferred to v1.x). Exposes the AFEStage
 * interface so the AFE graph drives it uniformly; future implementations
 * (WebRTC AEC3) can replace the passthrough behind the same contract.
 */

import type { AFEStage, AFEStageKind, AFEStageResult, AFEStageGeometry } from '@wake-studio/contracts'
import { MONO_STAGE_GEOMETRY } from '@wake-studio/contracts'
import { levelDb } from '@wake-studio/dsp'

export interface AecConfig {
  /** Passthrough for v1; kept as a flag so the panel is honest. */
  bypass: boolean
}

export class AecStage implements AFEStage {
  readonly kind: AFEStageKind = 'aec'
  /**
   * Declared geometry (issue #245): v1 is a passthrough, so it consumes and
   * produces single-mic and asks for no far-end reference. A real AEC3
   * implementation replaces the passthrough behind this same contract and
   * declares `referenceChannels: 1`, which the graph then refuses to serve on
   * a capture without a reference — the declaration is what makes an AEC
   * structurally impossible to enable by accident.
   */
  readonly geometry: AFEStageGeometry = MONO_STAGE_GEOMETRY
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
