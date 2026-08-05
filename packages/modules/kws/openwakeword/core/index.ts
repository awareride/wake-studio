/**
 * kws-openwakeword driver module - core exports.
 *
 * Registers the OpenWakeWord backend into the KWS engine registry (ADR-024
 * decoupling: adding a driver never edits the engine).
 */

import { registerKwsBackend } from '@wake-studio/module-kws-engine'
import { OpenWakeWordBackend } from './backend'

export { OpenWakeWordBackend } from './backend'

registerKwsBackend({
  id: 'openwakeword',
  label: 'OpenWakeWord (mel -> embedding -> classifier)',
  create: () => new OpenWakeWordBackend(),
  browserFeasible: true,
  availabilityNote: 'Available',
})
