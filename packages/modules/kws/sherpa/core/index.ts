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

export { SherpaOnnxKwsBackend } from './backend'
export type { SherpaOnnxKwsConfig } from '@wake-studio/module-kws-engine'

registerKwsBackend({
  id: 'sherpa-onnx-kws',
  label: 'sherpa-onnx KWS (direct keyword spotting)',
  create: () => new SherpaOnnxKwsBackend(),
  browserFeasible: true,
  availabilityNote: 'Inference only - prebuilt transducer model (ADR-020)',
  // Main-thread backend: the classic emscripten wasm needs DOM.
  mainThreadFactory: () => new SherpaOnnxKwsBackend(),
})
