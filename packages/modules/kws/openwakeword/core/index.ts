/**
 * kws-openwakeword driver module - core exports.
 *
 * Registers the OpenWakeWord backend into the KWS engine registry (ADR-024
 * decoupling: adding a driver never edits the engine).
 */

import { registerKwsBackend } from '@wake-studio/module-kws-engine'
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
})
