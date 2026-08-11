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
    Boolean(
      (urls as { kwsStreaming?: { model?: string; manifest?: string } })
        .kwsStreaming?.model &&
        (urls as { kwsStreaming?: { model?: string; manifest?: string } })
          .kwsStreaming?.manifest,
    ),
  spec: kwsStreamingSpec as unknown as ModuleSpec,
  // One model role: the exported graph. Its sidecar manifest travels with it
  // via the registry's manifestUrl, so the user picks a model, not a pair.
  modelRoles: [
    { role: 'kws-streaming-model', label: 'kws_streaming model', fallbackId: 'kws-streaming-kwt1' },
  ],
  // The graph + manifest must stay paired by construction; a custom URL
  // therefore also needs its manifest, derived by swapping .onnx -> .json
  // (what the exporter emits).
  resolveModelUrls: (ctx) => {
    const role = 'kws-streaming-model'
    const selected = ctx.modelSources[role]
    if (selected === 'custom') {
      const model = ctx.customUrls[role]?.trim()
      if (!model) return {}
      return {
        kwsStreaming: { model, manifest: model.replace(/\.onnx$/i, '.json') },
      }
    }
    const entry =
      ctx.registry.models.find((m) => m.id === selected) ??
      ctx.registry.models.find((m) => m.id === 'kws-streaming-kwt1')
    if (!entry?.manifestUrl) return {}
    return {
      kwsStreaming: { model: entry.url, manifest: entry.manifestUrl },
    }
  },
  // Engine-card resource: the graph + its sidecar manifest as one row.
  resources: [
    {
      id: 'kws-streaming-model',
      label: 'kws_streaming model + manifest',
      kind: 'model',
      urlKey: 'kwsStreaming',
    },
  ],
})
