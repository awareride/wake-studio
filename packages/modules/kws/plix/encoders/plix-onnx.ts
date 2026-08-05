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
 * External data: the `small` export stores its weights in a co-located
 * `plixkws-small.onnx.data` file (ONNX external_data). The browser build of
 * onnxruntime-web cannot read the filesystem, so these weights are passed via
 * the `externalData` session option (see `_externalDataOptions`); the `path`
 * must match the protobuf `location` exactly.
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
  melSpectrogram,
  fitFrames,
} from './plix-frontend'

// Serve the onnxruntime-web WASM runtime from the jsDelivr CDN (consistent with
// the OpenWakeWord backend, which does the same). Without this, the WASM files
// are fetched from a path relative to the worker/module URL and the session
// build fails (the failure is otherwise swallowed by the caller). Set once at
// module load; shared with any other backend in this worker.
ort.env.wasm.wasmPaths =
  'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/'

export class PlixOnnxEncoder implements PlixEncoder {
  readonly runtime = 'onnx' as const
  private _session: ort.InferenceSession | null = null
  private _inputName = ''

  get ready(): boolean {
    return this._session !== null
  }

  async load(url: string): Promise<void> {
    try {
      // Build session options. PLiX 'small' is exported with ONNX external
      // data (plixkws-small.onnx.data); onnxruntime-web cannot read the file
      // system in the browser, so external weights MUST be passed explicitly
      // via the `externalData` session option (ORT-web API): each entry pairs
      // the protobuf `location` (e.g. 'plixkws-small.onnx.data') with the URL
      // (or Blob/Uint8Array) of the weights file. We derive the URL from the
      // model URL's directory so the co-located `.data` file is resolved.
      // 'base' has no external data, so we pass an empty list (no-op).
      const externalData = this._externalDataOptions(url)
      this._session = await ort.InferenceSession.create(url, {
        executionProviders: ['wasm'],
        ...(externalData.length > 0 ? { externalData } : {}),
      })
    } catch (err) {
      throw new Error(
        `Failed to load PLiX ONNX model from ${url}: ` +
          (err instanceof Error ? err.message : String(err)),
      )
    }
    this._inputName = this._session.inputNames[0]
  }

  /**
   * External-data entries for `url`. Returns one entry per known external
   * data file co-located with the model. The `path` must exactly match the
   * `location` string stored in the ONNX protobuf (no './' prefix).
   */
  private _externalDataOptions(
    url: string,
  ): ReadonlyArray<{ path: string; data: string }> {
    const name = url.split('?')[0].split('/').pop() ?? ''
    const dir = url.includes('/')
      ? url.slice(0, url.lastIndexOf('/') + 1)
      : ''
    if (name === 'plixkws-small.onnx') {
      return [{ path: 'plixkws-small.onnx.data', data: dir + 'plixkws-small.onnx.data' }]
    }
    return []
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
    let mel = melSpectrogram(audio)
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
