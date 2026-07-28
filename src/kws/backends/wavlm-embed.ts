/**
 * WavLM embedding provider (ADR-020 EmbedProvider, Phase 3).
 *
 * Loads the WavLM-base-plus-sv speaker-verification model (ONNX, int8) and
 * extracts 512-dim speaker embeddings for Few-Shot prototype matching. This is
 * an auxiliary capability, independent of the detection `KWSBackend`: it is
 * loaded when a `wavlm` URL is provided so `KWSEngine.embed()` works for
 * enrollment regardless of which detection backend is active.
 *
 * Model I/O (verified: Xenova/wavlm-base-plus-sv, resolves Q-FS-1):
 *   input  'input_values' : [batch, sequence_length] float32 (16 kHz mono)
 *   output 'embeddings'   : [batch, 512]  (also 'logits' [batch, 512])
 *
 * Input normalization: the Wav2Vec2FeatureExtractor normalizes per-utterance
 * (zero-mean, unit-variance). We apply the same so embeddings match training.
 *
 * Execution provider: WavLM is **always run on WASM (CPU)**, not WebGPU. Its
 * ONNX graph contains ops (notably `Concat` with int64 shape tensors) that
 * onnxruntime-web's WebGPU EP fails to compile, raising a cascade of
 * "Invalid ComputePipeline \"Concat\"" validation errors at `run()` time.
 * WASM executes the same graph correctly. The OpenWakeWord detection backends
 * still use WebGPU where supported; only the WavLM embedder is pinned to WASM.
 *
 * @see docs/modules/kws.md §4 (EmbedProvider), §5 (Few-Shot scaffold)
 * @see docs/modules/kws.md §7 (error model / WebGPU fallback)
 */

import * as ort from 'onnxruntime-web'
import type { EmbedProvider } from '../types'

/** Per-utterance normalization (Wav2Vec2FeatureExtractor default: eps=1e-7). */
function normalize(audio: Float32Array, eps = 1e-7): Float32Array {
  let mean = 0
  for (let i = 0; i < audio.length; i++) mean += audio[i]
  mean /= audio.length
  let variance = 0
  for (let i = 0; i < audio.length; i++) {
    const d = audio[i] - mean
    variance += d * d
  }
  variance /= audio.length
  const std = Math.sqrt(variance + eps)
  const out = new Float32Array(audio.length)
  for (let i = 0; i < audio.length; i++) out[i] = (audio[i] - mean) / std
  return out
}

/**
 * WavLM-base-plus-sv embedder. Expects 16 kHz mono float32 input; the caller is
 * responsible for resampling (the AFE output is already 16 kHz).
 */
export class WavLMEmbedProvider implements EmbedProvider {
  private _session: ort.InferenceSession | null = null

  get ready(): boolean {
    return this._session !== null
  }

  async load(url: string, _provider: 'webgpu' | 'wasm'): Promise<void> {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(
        `Failed to fetch ${url}: ${response.status} ${response.statusText}`,
      )
    }
    const buffer = await response.arrayBuffer()
    // Force WASM only. The `provider` arg is intentionally ignored (see the
    // class docstring): this model's graph is incompatible with ORT-Web's
    // WebGPU EP and would otherwise fail with "Invalid ComputePipeline
    // 'Concat'" validation errors during run().
    this._session = await ort.InferenceSession.create(buffer, {
      executionProviders: ['wasm'],
    })
  }

  async embed(audio: Float32Array, sampleRate: number): Promise<Float32Array> {
    // WavLM expects 16 kHz mono. The sampleRate param is part of the embed
    // contract for future use; the AFE output is already 16 kHz in v1.
    void sampleRate

    if (!this._session) {
      throw new Error('WavLM model not loaded; embed() unavailable.')
    }

    // Normalize input (Wav2Vec2FeatureExtractor: zero-mean, unit-variance).
    const normalized = normalize(audio)
    const inputName = this._session.inputNames[0] // 'input_values'
    const inputTensor = new ort.Tensor('float32', normalized, [
      1,
      normalized.length,
    ])
    const outputs = await this._session.run({ [inputName]: inputTensor })

    // Prefer the 'embeddings' output; fall back to the first output.
    const outputName = this._session.outputNames.includes('embeddings')
      ? 'embeddings'
      : this._session.outputNames[0]
    const embedding = outputs[outputName] as ort.Tensor
    return embedding.data as Float32Array
  }

  async dispose(): Promise<void> {
    this._session = null
  }
}
