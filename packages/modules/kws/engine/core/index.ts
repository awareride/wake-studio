/**
 * KWS engine module - core exports.
 *
 * @see docs/modules/kws.md for the full contract (ADR-018, ADR-020).
 *
 * The engine owns the generic loop (VAD gate, smoothing, trigger) and the
 * KWSBackend interface; driver modules (openwakeword / sherpa / plix) plug in
 * via the registry (ADR-024 decoupling rule).
 */

export { KWSEngine } from './KWSEngine'
export { DEFAULT_CONFIG, describeParameters } from './defaults'
export { MEL_WINDOW_SIZE, MEL_HOP_SIZE, MEL_OVERLAP } from './defaults'
export { ScoreSmoother, TriggerDetector, shouldGateByVad } from './logic'
export {
  createBackend,
  createEmbedProvider,
  createMainThreadBackend,
  getBackendRegistration,
  getBackendRegistry,
  registerEmbedProviderFactory,
  registerKwsBackend,
} from './backend'
export type { KWSBackendRegistration, EmbedProviderFactory } from './backend'

export type {
  BackendModelUrls,
  EmbedProvider,
  KWSBackend,
  KWSBackendCategory,
  KWSBackendId,
  KWSConfig,
  KWSScoreSample,
  KWSTriggerEvent,
  KWSStatus,
  ParameterDescriptor,
  SherpaOnnxKwsConfig,
} from './types'
export { KWSLoadError, KWSUnsupportedError } from './types'
export type { ModelRuntime } from '@wake-studio/platform'
