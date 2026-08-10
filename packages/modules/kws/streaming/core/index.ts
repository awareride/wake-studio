/**
 * kws-streaming driver module - core exports.
 *
 * Registers the `kws_streaming` Traditional backend into the KWS engine
 * registry (ADR-024 decoupling: adding a driver never edits the engine).
 */

import { registerKwsBackend } from '@wake-studio/module-kws-engine'
import type { ModuleSpec } from '@wake-studio/contracts'
import { KWSStreamingBackend } from './backend'
import kwsStreamingSpec from '../spec/module.spec.json'

export { KWSStreamingBackend, type KwsStreamingConfig } from './backend'
export {
  type KwsStreamingManifest,
  type KwsStreamingState,
  KwsStreamingManifestError,
  STREAMABLE_MODELS,
  stateSize,
  validateManifest,
} from './manifest'
export {
  PacketBuffer,
  advanceStates,
  createStateBag,
  resetStateBag,
  selectLabelScore,
  softmax,
  stateBagBytes,
} from './streaming'

registerKwsBackend({
  id: 'kws-streaming',
  label: 'kws_streaming (Traditional streaming-aware)',
  category: 'traditional',
  create: () => new KWSStreamingBackend(),
  browserFeasible: true,
  // Upstream ships code, not weights: the driver is browser-feasible but needs
  // a model the user trained (or supplied) first.
  availabilityNote: 'Requires a trained model (upstream ships no weights)',
  spec: kwsStreamingSpec as unknown as ModuleSpec,
})
