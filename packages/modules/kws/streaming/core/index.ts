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
  availabilityNote: 'Pretrained: Keyword Transformer / att_mh_rnn (12 labels)',
  // This driver needs a graph + its sidecar manifest, not the openwakeword
  // model triple. Declaring it here keeps the worker free of per-backend
  // cases (ADR-024).
  hasRequiredUrls: (urls) =>
    Boolean(urls.kwsStreaming?.model && urls.kwsStreaming?.manifest),
  spec: kwsStreamingSpec as unknown as ModuleSpec,
})
