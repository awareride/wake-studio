/**
 * PLiX embedding provider (ADR-020 EmbedProvider, Phase 3).
 *
 * A thin factory over the pluggable PLiX encoder (`PlixEncoder`). It selects
 * the runtime - ONNX (onnxruntime-web, default) or Transformers.js
 * (no ONNX file needed) - based on the `plixkwsRuntime` hint, and
 * delegates `embed()` to the chosen encoder. This keeps the rest of the
 * pipeline (ring buffer, prototype-distance scoring, UI) runtime-agnostic.
 *
 * PLiX replaces WavLM-base-plus as the Few-Shot encoder: its compact CNN
 * (EfficientNet-v2 "base" / TinyNet-E "small") is far lighter and was
 * designed for end-side / IoT devices. Both runtimes produce the same 1280-dim
 * embedding from a 16 kHz clip, so prototype-distance scoring is identical.
 *
 * Historically the encoder needed an exported ONNX graph; we now also support
 * running it browser-native via @xenova/transformers (zero-Python
 * deployment), and via ExecuTorch WASM (the native/on-device slot; currently
 * deferred - see plix-executorch.ts). The choice depends on the deployment
 * (ADR-002):
 *   - 'onnx'        : needs `prebuilts/plixkws/plixkws-<variant>.onnx`
 *                      (see scripts/export-plixkws-onnx.py). Default. The
 *                      `small` export uses external data
 *                      (plixkws-small.onnx.data), served co-located.
 *   - 'transformers' : no ONNX file; loads weights via @huggingface/transformers.
 *   - 'executorch'   : ExecuTorch WASM (.pte); deferred - see plix-executorch.ts.
 *
 * @see docs/modules/kws.md §4 (EmbedProvider), §5 (Few-Shot scaffold)
 * @see docs/Technical Reference_ Resource Requirements and Zero-Python
 *      Deployment Strategies for WavLM-base-plus and plixkws.md §3.1
 */

import type { EmbedProvider, ModelRuntime } from '@wake-studio/module-kws-engine'
import type { PlixEncoder } from './plix-encoder'
import { PlixOnnxEncoder } from './plix-onnx'
import { PlixTransformersEncoder } from './plix-transformers'
import { PlixExecuTorchEncoder } from './plix-executorch'

/**
 * @param runtime  'onnx' (default), 'transformers', or 'executorch' (deferred).
 * @param modelId  for 'onnx' this is the ONNX URL; for 'transformers' this
 *                   is the Hugging Face model id (e.g. 'aaqibsaeed/plixkws');
 *                   for 'executorch' this is the `.pte` program URL.
 */
export class PlixKwsEmbedProvider implements EmbedProvider {
  private _runtime: ModelRuntime
  private _modelId: string
  private _encoder: PlixEncoder | null = null

  constructor(modelId: string, runtime: ModelRuntime = 'onnx') {
    this._runtime = runtime
    this._modelId = modelId
  }

  get ready(): boolean {
    return this._encoder?.ready ?? false
  }

  async load(_url: string, _provider: 'webgpu' | 'wasm'): Promise<void> {
    // The old EmbedProvider.load(url) contract is kept for compat; the model
    // locator is taken from the constructor (plixkws URL or HF model id).
    this._encoder = this._createEncoder()
    await this._encoder.load(this._modelId)
  }

  private _createEncoder(): PlixEncoder {
    if (this._runtime === 'transformers') {
      return new PlixTransformersEncoder(this._modelId)
    }
    if (this._runtime === 'executorch') {
      return new PlixExecuTorchEncoder(this._modelId)
    }
    return new PlixOnnxEncoder()
  }

  async embed(audio: Float32Array, sampleRate: number): Promise<Float32Array> {
    if (!this._encoder?.ready) {
      throw new Error('PLiX encoder not loaded; embed() unavailable.')
    }
    return this._encoder.embed(audio, sampleRate)
  }

  async dispose(): Promise<void> {
    await this._encoder?.dispose()
    this._encoder = null
  }
}
