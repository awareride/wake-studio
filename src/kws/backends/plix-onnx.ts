/**
 * PLiX encoder runtime: ONNX (onnxruntime-web).
 *
 * The default PLiX runtime. Loads an exported `plixkws-*.onnx` graph whose
 * input is the 1x64x100 log-Mel spectrogram (see `plix-frontend.ts`) and
 * whose output is the 1280-dim embedding. The front-end is computed in JS
 * (`plix-frontend.logMelSpectrogram`) so the ONNX graph stays tiny.
 *
 * Pinned to WASM (CPU): onnxruntime-web's WebGPU EP fails to compile the
 * graph's shape/op set at run() time (same as the old WavLM embedder).
 *
 * @see docs/Technical Reference_ Resource Requirements and Zero-Python
 *      Deployment Strategies for WavLM-base-plus and plixkws.md §3
 */

import * as ort from 'onnxruntime-web'
import type { PlixEncoder } from './plix-encoder'
import {
  PLIX_SAMPLE_RATE,
  PLIX_WINDOW_LENGTH,
  PLIX_HOP_LENGTH,
  PLIX_N_MELS,
  PLIX_TARGET_FRAMES,
  logMelSpectrogram,
  fitFrames,
} from './plix-frontend'

export class PlixOnnxEncoder implements PlixEncoder {
  readonly runtime = 'onnx' as const
  private _session: ort.InferenceSession | null = null
  private _inputName = ''

  get ready(): boolean {
    return this._session !== null
  }

  async load(url: string): Promise<void> {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(
        `Failed to fetch ${url}: ${response.status} ${response.statusText}`,
      )
    }
    const buffer = await response.arrayBuffer()
    this._session = await ort.InferenceSession.create(buffer, {
      executionProviders: ['wasm'],
    })
    this._inputName = this._session.inputNames[0]
  }

  async embed(audio: Float32Array, sampleRate: number): Promise<Float32Array> {
    if (sampleRate !== PLIX_SAMPLE_RATE) {
      throw new Error(
        `PLiX encoder expects ${PLIX_SAMPLE_RATE} Hz audio; got ${sampleRate} Hz.`,
      )
    }
    if (!this._session) {
      throw new Error('PLiX (onnx) encoder not loaded; embed() unavailable.')
    }
    let mel = logMelSpectrogram(audio)
    const numFrames = Math.floor(
      (audio.length - PLIX_WINDOW_LENGTH) / PLIX_HOP_LENGTH + 1,
    )
    mel = fitFrames(mel, numFrames)

    const inputTensor = new ort.Tensor(
      'float32',
      mel,
      [1, 1, PLIX_N_MELS, PLIX_TARGET_FRAMES],
    )
    const outputs = await this._session.run({ [this._inputName]: inputTensor })
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
