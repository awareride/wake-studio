/**
 * WavLM embedding provider (ADR-020 EmbedProvider, Phase 3 scaffold).
 *
 * Loads the frozen WavLM-base-plus encoder (int8 ONNX) and extracts speaker
 * embeddings for Few-Shot prototype matching. This is an auxiliary capability,
 * independent of the detection `KWSBackend`: it is loaded when a `wavlm` URL is
 * provided so `KWSEngine.embed()` works for Phase 3 enrollment prep regardless
 * of which detection backend is active.
 *
 * @see docs/modules/kws.md §4 (EmbedProvider), §5 (Few-Shot scaffold)
 */

import * as ort from 'onnxruntime-web'
import type { EmbedProvider } from '../types'

/**
 * WavLM-base-plus embedder. Expects 16 kHz mono float32 input; the caller is
 * responsible for resampling (the AFE output is already 16 kHz).
 */
export class WavLMEmbedProvider implements EmbedProvider {
  private _session: ort.InferenceSession | null = null

  get ready(): boolean {
    return this._session !== null
  }

  async load(url: string, provider: 'webgpu' | 'wasm'): Promise<void> {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(
        `Failed to fetch ${url}: ${response.status} ${response.statusText}`,
      )
    }
    const buffer = await response.arrayBuffer()
    this._session = await ort.InferenceSession.create(buffer, {
      executionProviders: provider === 'webgpu' ? ['webgpu', 'wasm'] : ['wasm'],
    })
  }

  async embed(audio: Float32Array, sampleRate: number): Promise<Float32Array> {
    // WavLM expects 16 kHz mono. The sampleRate param is part of the embed
    // contract for future use; the AFE output is already 16 kHz in v1.
    void sampleRate

    if (!this._session) {
      throw new Error('WavLM model not loaded; embed() unavailable.')
    }

    const inputName = this._session.inputNames[0]
    const inputTensor = new ort.Tensor('float32', audio, [1, audio.length])
    const outputs = await this._session.run({ [inputName]: inputTensor })
    const outputName = this._session.outputNames[0]
    const embedding = outputs[outputName] as ort.Tensor
    return embedding.data as Float32Array
  }

  async dispose(): Promise<void> {
    this._session = null
  }
}
