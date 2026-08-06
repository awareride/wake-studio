/**
 * PLiX encoder runtime: @huggingface/transformers (v4 browser build) - NO .pt.
 *
 * The zero-Python / non-ONNX-deployment route for PLiX (see the Technical
 * Reference doc §3.1). The encoder is loaded with Hugging Face Transformers
 * v4 (`@huggingface/transformers`), which runs the model browser-native via
 * its bundled onnxruntime-web (WASM/WebGPU). It fetches the model's ONNX
 * weights directly from a Hugging Face repo id (or a locally-served HF-style
 * `config.json` + `onnx/` directory) - there is **no .pt / TorchScript file**
 * and **no npm install required** when loaded from the CDN.
 *
 * Why this shape (and not the `feature-extraction` pipeline): PLiX is a raw
 * audio -> log-Mel -> CNN model with NO tokenizer / processor. The
 * `feature-extraction` pipeline expects a text/image processor, so for a custom
 * audio CNN the correct v4 pattern is `AutoModel.from_pretrained(idOrPath)`
 * followed by a direct `model(new Tensor('float32', mel, [1,1,64,100]))` call,
 * feeding the SAME 1x64x100 log-Mel image the ONNX runtime uses. The resulting
 * embedding is therefore identical to the ONNX path (same `plixkws/backbone.py`
 * architecture). The acoustic front-end is computed here in JS
 * (`plix-frontend.logMelSpectrogram`) so both runtimes share it.
 *
 * Locator forms (the `modelId` passed to the constructor / `load`):
 *   - HF repo id  : e.g. 'aaqibsaeed/plixkws' (weights fetched from the Hub).
 *   - local HF dir: e.g. '/modules/kws/plix/assets/hf/plixkws' - set via
 *     `env.localModelPath` + `allowRemoteModels=false`; the dir must contain
 *     config.json and onnx/model.onnx.
 *
 * Dependency note: `@huggingface/transformers` is imported **dynamically**
 * only when this runtime is selected, so it is NOT a hard dependency of the
 * default ONNX path. It is an `optionalDependency` in package.json and is
 * code-split by Vite (declared external in vite.config.ts) so it is only
 * fetched when `runtime: "transformers"` is used. When served from the CDN
 * (https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0/dist/) no
 * install is required at all.
 *
 * @see docs/Technical Reference_ Resource Requirements and Zero-Python
 *      Deployment Strategies for WavLM-base-plus and plixkws.md §3.1
 */

import type { PlixEncoder } from './plix-encoder'
import { PLIX_EMBEDDING_DIM } from './plix-encoder'
import {
  PLIX_SAMPLE_RATE,
  PLIX_N_MELS,
  PLIX_TARGET_FRAMES,
  PLIX_WINDOW_LENGTH,
  PLIX_HOP_LENGTH,
  melSpectrogram,
  fitFrames,
} from './plix-frontend'

// `@huggingface/transformers` is an OPTIONAL dependency (not installed by
// default). The 'transformers' runtime loads it from the jsDelivr CDN at
// runtime - no npm install required. We import the package's browser ESM
// build by full URL (not the bare specifier) because a bare specifier cannot
// be resolved in the browser and would throw
// "Failed to resolve module specifier '@huggingface/transformers'". The
// version is pinned to match package.json's optionalDependencies range.
const HF_TRANSFORMERS_CDN =
  'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0'

// Type-only imports (erased at build time; do not affect runtime resolution).
// The package's real v4 browser types resolve from its installed `types` entry
// (it is a transitive dep of the plix module; the browser import is a CDN
// URL at runtime, so this is type-check-only). We narrow to the small surface
// this encoder actually uses: the model instance is callable with a named
// inputs object and exposes `input_names`; the tensor is `Tensor`.
import type { AutoModel, Tensor as OrtTensor } from '@huggingface/transformers'

/** Minimal model surface the PLiX encoder uses (v4 PreTrainedModel). */
interface PlixTransformersModel {
  (inputs: Record<string, OrtTensor>): Promise<Record<string, OrtTensor>>
  input_names?: string[]
}

export class PlixTransformersEncoder implements PlixEncoder {
  readonly runtime = 'transformers' as const
  private _model: PlixTransformersModel | null = null
  private _TensorCtor: typeof OrtTensor | null = null
  private _modelId: string

  constructor(modelId: string) {
    this._modelId = modelId
  }

  get ready(): boolean {
    return this._model !== null
  }

  async load(_locator: string): Promise<void> {
    // Dynamic import: @huggingface/transformers is only fetched when this
    // runtime is actually selected (keeps the default ONNX path light). We
    // import the full CDN ESM URL (HF_TRANSFORMERS_CDN) rather than the bare
    // package specifier, because a bare specifier cannot be resolved in the
    // browser. The @vite-ignore tells Vite not to rewrite/analyze this remote
    // URL at build time - it is fetched at runtime when this runtime is used.
    const mod = (await import(/* @vite-ignore */ HF_TRANSFORMERS_CDN)) as unknown as {
      AutoModel: typeof AutoModel
      env: {
        allowRemoteModels: boolean
        allowLocalModels?: boolean
        localModelPath?: string
        [key: string]: unknown
      }
      Tensor: typeof OrtTensor
    }

    // When the locator is a local path (starts with '/'), serve the model from
    // a locally-hosted HF-style directory instead of the Hub. Transformers.js
    // looks for `<localModelPath>/<modelId>/...`, so split the path into the
    // base dir and the trailing id.
    if (this._modelId.startsWith('/')) {
      const idx = this._modelId.lastIndexOf('/')
      const base = this._modelId.slice(0, idx) // e.g. /modules/kws/plix/assets/hf
      const id = this._modelId.slice(idx + 1) // e.g. plixkws
      mod.env.allowRemoteModels = false
      mod.env.allowLocalModels = true
      mod.env.localModelPath = base
      this._TensorCtor = mod.Tensor
      // The 'small' export stores its large weight tensor as ONNX external
      // data. Transformers.js / onnxruntime-web resolves external data in the
      // browser via a HARDCODED `_data` naming convention: it looks for
      // `<graph-without-.onnx>_data` (i.e. `onnx/model.onnx_data`), IGNORING
      // the protobuf `location` AND any `externalData` option we pass when
      // external tensors are present. The generated HF-style graph (staged by
      // packages/modules/kws/plix/scripts/build-plix.mjs) therefore rewrites
      // the external `location` to `model.onnx_data` so it matches. We still
      // pass `externalData` under that key (the graph's
      // `onnx/model.onnx_data` file also exists on disk, so ORT-web can fetch
      // it directly if preferred).
      const onnxDir = `${this._modelId}/onnx`
      const externalData = [
        {
          path: 'model.onnx_data',
          data: `${onnxDir}/model.onnx_data`,
        },
      ]
      this._model = (await mod.AutoModel.from_pretrained(id, {
        dtype: 'fp32',
        use_external_data_format: true,
        // v4's public PretrainedModelOptions dropped `externalData`, but the
        // runtime still accepts it for ONNX external-data weights (see the
        // onnx/model.onnx_data convention above). Narrow the option locally.
        externalData,
      } as Parameters<typeof mod.AutoModel.from_pretrained>[1] & {
        externalData: Array<{ path: string; data: string }>
      })) as unknown as PlixTransformersModel
      return
    }

    this._TensorCtor = mod.Tensor
    this._model = (await mod.AutoModel.from_pretrained(this._modelId, {
      // Run on the CPU via WASM (matches the ONNX runtime's pinned EP).
      dtype: 'fp32',
    })) as unknown as PlixTransformersModel
  }

  async embed(audio: Float32Array, sampleRate: number): Promise<Float32Array> {
    if (sampleRate !== PLIX_SAMPLE_RATE) {
      throw new Error(
        `PLiX encoder expects ${PLIX_SAMPLE_RATE} Hz audio; got ${sampleRate} Hz.`,
      )
    }
    if (!this._model || !this._TensorCtor) {
      throw new Error('PLiX (transformers) encoder not loaded; embed() unavailable.')
    }

    // Build the shared 1x64x100 raw-mel front-end (identical to ONNX path).
    // The graph applies the log itself, so this is raw mel magnitude.
    let mel = melSpectrogram(audio)
    const numFrames = Math.floor(
      (audio.length - PLIX_WINDOW_LENGTH) / PLIX_HOP_LENGTH + 1,
    )
    mel = fitFrames(mel, numFrames)

    // Stack into a single 1x1x64x100 image and run the model. Transformers.js
    // expects a NAMED inputs object (keyed by the model's input name), not a
    // positional tensor - a positional tensor fails with "Missing the following
    // inputs: <name>".
    const input = new this._TensorCtor(
      'float32',
      mel,
      [1, 1, PLIX_N_MELS, PLIX_TARGET_FRAMES],
    )
    const inputName = this._model.input_names?.[0] ?? 'input'
    const out = await this._model({ [inputName]: input })
    const outTensor: OrtTensor | undefined =
      (out as { last_hidden_state?: OrtTensor }).last_hidden_state ??
      (Object.values(out)[0] as OrtTensor)
    if (!outTensor) {
      throw new Error('PLiX (transformers) encoder returned no tensor.')
    }
    const embedding = Float32Array.from(outTensor.data)
    if (embedding.length !== PLIX_EMBEDDING_DIM) {
      // Defensive: PLiX base/small both emit 1280-d; warn if not.
      console.warn(
        `[PLiX] encoder emitted ${embedding.length}-d vector; expected ${PLIX_EMBEDDING_DIM}-d.`,
      )
    }
    return embedding
  }

  async dispose(): Promise<void> {
    this._model = null
    this._TensorCtor = null
  }
}
