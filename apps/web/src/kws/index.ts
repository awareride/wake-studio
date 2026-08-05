/**
 * KWS module - apps/web facade.
 *
 * The implementation moved to the KWS engine + driver modules (module-migration
 * §6.3): `@wake-studio/module-kws-engine` (engine + registry seam) and the
 * driver modules (openwakeword / sherpa / plix). This file re-exports the
 * engine's public API for migration compatibility AND imports the driver
 * modules so their registration side-effects run (ADR-024 decoupling).
 *
 * New imports should come from the module packages directly.
 */

// Registration side-effects (must run once): driver modules register into the
// engine's registry. Importing this facade registers all browser-feasible
// backends (openwakeword, sherpa-onnx-kws, plixkws) + the plix embed provider.
import '@wake-studio/module-kws-openwakeword'
import '@wake-studio/module-kws-sherpa'
import '@wake-studio/module-kws-plix'

export {
  KWSEngine,
  DEFAULT_CONFIG,
  describeParameters,
  MEL_WINDOW_SIZE,
  MEL_HOP_SIZE,
  MEL_OVERLAP,
  ScoreSmoother,
  TriggerDetector,
  shouldGateByVad,
  createBackend,
  createMainThreadBackend,
  getBackendRegistration,
  getBackendRegistry,
  registerEmbedProviderFactory,
  registerKwsBackend,
} from '@wake-studio/module-kws-engine'
export type { KWSBackendRegistration } from '@wake-studio/module-kws-engine'

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
  SherpaOnnxKwsConfig,
} from '@wake-studio/module-kws-engine'
export { KWSLoadError, KWSUnsupportedError } from '@wake-studio/module-kws-engine'
export type { ModelRuntime } from '@wake-studio/platform'
