/**
 * KWS module - public exports.
 *
 * @see docs/modules/kws.md for the full contract (ADR-018, ADR-020).
 */

export { KWSEngine } from './KWSEngine'
export { DEFAULT_CONFIG, describeParameters } from './defaults'
export { MEL_WINDOW_SIZE, MEL_HOP_SIZE, MEL_OVERLAP } from './defaults'
export { ScoreSmoother, TriggerDetector, shouldGateByVad } from './dsp'
export { BACKEND_REGISTRY, createBackend, getBackendRegistration } from './backend'
export type { KWSBackendRegistration } from './backend'

export type {
  BackendModelUrls,
  EmbedProvider,
  KWSBackend,
  KWSBackendId,
  KWSConfig,
  KWSScoreSample,
  KWSTriggerEvent,
  KWSStatus,
  ParameterDescriptor,
} from './types'
export { KWSLoadError, KWSUnsupportedError } from './types'
