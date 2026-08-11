/**
 * kws-openwakeword driver module - core exports.
 *
 * Registers the OpenWakeWord backend into the KWS engine registry (ADR-024
 * decoupling: adding a driver never edits the engine).
 */

import { registerKwsBackend, resolveRoleUrl } from '@wake-studio/module-kws-engine'
import { OpenWakeWordBackend } from './backend'
import type { ModuleSpec } from '@wake-studio/contracts'
import openWakeWordSpec from '../spec/module.spec.json'

export { OpenWakeWordBackend } from './backend'

registerKwsBackend({
  id: 'openwakeword',
  label: 'OpenWakeWord (mel -> embedding -> classifier)',
  category: 'traditional',
  create: () => new OpenWakeWordBackend(),
  browserFeasible: true,
  availabilityNote: 'Available',
  // The driver's own spec (ADR-025): hosts render its params (threshold)
  // from the registry instead of hard-coding per-backend cases.
  spec: openWakeWordSpec as unknown as ModuleSpec,
  // The three openwakeword model roles (ADR-024): the host renders the
  // Model-source editor from this, and the driver owns the URL mapping.
  modelRoles: [
    { role: 'melspectrogram', label: 'Mel front-end', fallbackId: 'melspectrogram' },
    { role: 'embedding', label: 'Embedding backbone', fallbackId: 'speech_embedding' },
    { role: 'classifier', label: 'Wake-word classifier', fallbackId: 'hey-buddy' },
  ],
  resolveModelUrls: (ctx) => ({
    melspectrogram: resolveRoleUrl(ctx, 'melspectrogram', 'melspectrogram'),
    embedding: resolveRoleUrl(ctx, 'embedding', 'speech_embedding'),
    classifier: resolveRoleUrl(ctx, 'classifier', 'hey-buddy'),
  }),
  // Engine-card resources (ADR-024): one row per model this backend loads.
  resources: [
    { id: 'melspectrogram', label: 'Mel-spectrogram front-end', kind: 'model', urlKey: 'melspectrogram' },
    { id: 'embedding', label: 'Speech embedding backbone', kind: 'model', urlKey: 'embedding' },
    { id: 'classifier', label: 'Wake-word classifier', kind: 'model', urlKey: 'classifier' },
  ],
})
