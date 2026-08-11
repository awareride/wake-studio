/**
 * kws-sherpa driver module - core exports.
 *
 * Registers the sherpa-onnx-kws backend into the KWS engine registry. It
 * provides BOTH the worker factory and the main-thread factory: the classic
 * emscripten wasm needs DOM, so the engine drives it on the main thread
 * (ADR-018); the worker path is reserved for a future DOM-less build.
 */

import { registerKwsBackend } from '@wake-studio/module-kws-engine'
import { SherpaOnnxKwsBackend } from './backend'
import type { ModuleSpec, ProvisionArtifact } from '@wake-studio/contracts'
import sherpaSpec from '../spec/module.spec.json'
import sherpaProvisionSpec from '../spec/provision.spec.json'

export { SherpaOnnxKwsBackend } from './backend'
export type { SherpaOnnxKwsConfig } from '@wake-studio/module-kws-engine'

registerKwsBackend({
  id: 'sherpa-onnx-kws',
  label: 'sherpa-onnx KWS (direct keyword spotting)',
  category: 'asr-decoding',
  create: () => new SherpaOnnxKwsBackend(),
  browserFeasible: true,
  availabilityNote: 'Inference only - prebuilt transducer model (ADR-020)',
  // The driver's own spec (ADR-025): hosts render its params (keywords,
  // threshold) from the registry instead of hard-coding per-backend cases.
  spec: sherpaSpec as unknown as ModuleSpec,
  // Main-thread backend: the classic emscripten wasm needs DOM.
  mainThreadFactory: () => new SherpaOnnxKwsBackend(),
  // Provisioning capability (ADR-033): this backend loads WITH a keyword
  // list artifact. The host renders the driver's keywords param, calls
  // produce() to validate/normalize the keyword text into an artifact, then
  // feeds apply() into engine.load (the keyword list rides in backendConfig,
  // which the main-thread backend's configure() already consumes).
  provision: {
    kind: 'list',
    // The provisioning panel spec (separate from the driver config spec):
    // the load-with-list action + keyword-list status, rendered generically.
    spec: sherpaProvisionSpec as unknown as ModuleSpec,
    // Input: the keyword-list text (sherpa format - one
    // `spaced tokens @display name` per line, from the driver's keywords
    // param). Validates non-empty and returns the serialized artifact.
    produce: async (input) => {
      const { keywords } = input as { keywords?: string }
      const text = (keywords ?? '').trim()
      if (!text) {
        throw new Error('The keyword list is empty - enter at least one wake word.')
      }
      return {
        kind: 'list',
        backendId: 'sherpa-onnx-kws',
        payload: { keywords: text },
      }
    },
    // Load-time mapping: the keyword list rides in backendConfig (already the
    // shape the main-thread backend's configure() reads). The host merges its
    // live driver values (threshold) over the applied config.
    apply: (artifact: ProvisionArtifact) => {
      if (artifact.kind !== 'list') {
        throw new Error('sherpa-onnx-kws only consumes keyword-list artifacts.')
      }
      return { backendConfig: { keywords: artifact.payload.keywords } }
    },
  },
  // Engine-card resources (ADR-024). The wasm package bundles the model, so
  // there are no model sources and no URL mapping; only the wasm runtime and
  // the editable wake-word list (a driver param) are shown.
  resources: [
    { id: 'wasm', label: 'sherpa-onnx KWS wasm runtime', kind: 'model' },
    {
      id: 'keywords',
      label: 'Wake-word list',
      kind: 'data',
      state: (ctx) => {
        const text = String(ctx.driverValues.keywords ?? '')
        const count = text.split('\n').filter(Boolean).length
        return { ready: count > 0, detail: `${count} keyword(s)` }
      },
    },
  ],
})
