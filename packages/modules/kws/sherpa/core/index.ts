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
import type { ModuleSpec } from '@wake-studio/contracts'
import sherpaSpec from '../spec/module.spec.json'

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
})
