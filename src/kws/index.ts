/**
 * KWS module - public exports.
 *
 * @see docs/modules/kws.md for the full contract (ADR-018).
 */

export { KWSEngine } from './KWSEngine'
export { DEFAULT_CONFIG, describeParameters } from './defaults'
export { MEL_WINDOW_SIZE, MEL_HOP_SIZE } from './defaults'
export { ScoreSmoother, TriggerDetector, shouldGateByVad } from './dsp'

export type {
  KWSConfig,
  KWSMode,
  KWSScoreSample,
  KWSTriggerEvent,
  KWSStatus,
  ModelUrls,
  ParameterDescriptor,
} from './types'
export { KWSLoadError, KWSUnsupportedError } from './types'
