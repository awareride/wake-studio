/**
 * PLiX encoder runtime interface (ADR-002).
 *
 * A PLiX encoder turns a 16 kHz mono clip into a 1280-dim embedding; the
 * Few-Shot backend then scores it against an enrolled prototype. PLiX can be
 * served by more than one runtime, and the choice depends on the deployment:
 *
 *   - 'onnx'        -> onnxruntime-web (default). Needs an exported
 *                       `plixkws-<variant>.onnx` file (see
 *                       packages/modules/kws/plix/scripts/export-plixkws-onnx.py).
 *                       The `small` export uses external data
 *                       (plixkws-small.onnx.data).
 *   - 'transformers' -> @xenova/transformers `feature-extraction`
 *                       pipeline, run browser-native via WASM/WebGPU. **No ONNX
 *                       file required** - it loads safetensors/bin weights
 *                       directly (the zero-Python deployment route; see
 *                       docs/Technical Reference_ ... plixkws.md §3.1).
 *
 * Both runtimes share the same acoustic front-end and produce the same embedding
 * (the ONNX graph and the Transformers.js pipeline are both derived from
 * `plixkws/backbone.py::Backbone`), so prototype-distance scoring is identical.
 *
 * @see docs/Technical Reference_ Resource Requirements and Zero-Python
 *      Deployment Strategies for WavLM-base-plus and plixkws.md
 */

import type { ModelRuntime } from '@wake-studio/platform'

/** A PLiX encoder runtime: 16 kHz mono audio -> 1280-dim embedding. */
export interface PlixEncoder {
  readonly runtime: ModelRuntime
  readonly ready: boolean
  /** Load the encoder from the given model locator (URL or HF model id). */
  load(locator: string): Promise<void>
  /** Embed one 16 kHz mono clip. */
  embed(audio: Float32Array, sampleRate: number): Promise<Float32Array>
  dispose(): Promise<void>
}

export const PLIX_EXPECTED_SAMPLE_RATE = 16000
export const PLIX_EMBEDDING_DIM = 1280

/**
 * PLiX encoder variant descriptor (ADR-002).
 *
 * Both variants emit the SAME 1280-dim embedding from the same 1x64x100 log-Mel
 * front-end, so prototype-distance scoring is identical (only compute/params
 * differ). `base` = EfficientNet-v2-M; `small` = TinyNet-E (lighter, for
 * low-RAM / end-side devices). The `small` export uses external data
 * (`plixkws-small.onnx.data`), which must be served alongside the `.onnx`.
 */
export interface PlixEncoderVariant {
  /** Variant key (stable identifier used in the UI + registry). */
  id: 'base' | 'small'
  /** Human-readable label shown in the encoder selector. */
  label: string
  /** Local ONNX URL served from /modules/kws/plix/assets/ (onnx runtime). */
  onnxUrl: string
  /**
   * Local HF-style directory URL for the transformers runtime. The PLiX ONNX
   * graph is NOT hosted on the Hub (the `aaqibsaeed/plixkws` repo only ships
   * `.pt` weights + config.json), so the transformers runtime must load the
   * graph from a locally-exported HF-style dir produced by the PLiX module
   * build (packages/modules/kws/plix/scripts/build-plix.mjs), which stages
   * hf/plixkws/ (config.json + onnx/model.onnx). This path starts with '/' so
   * the encoder serves it from the dev server (no remote fetch).
   */
  transformersLocalDir: string
  /** One-line note shown in the encoder selector. */
  note: string
}

/**
 * The selectable PLiX encoder variants. The `onnxUrl` points at the ONNX
 * graph exported by packages/modules/kws/plix/scripts/export-plixkws-onnx.py
 * (see the generic module build workflow, ADR-027 §6.7, with
 * `--encoder base|small`).
 */
export const PLIX_ENCODER_VARIANTS: ReadonlyArray<PlixEncoderVariant> = [
  {
    id: 'base',
    label: 'PLiX base (EfficientNet-v2-M, 1280-d)',
    onnxUrl: '/modules/kws/plix/assets/plixkws-base.onnx',
    transformersLocalDir: '/modules/kws/plix/assets/hf/plixkws',
    note: 'Heavier CNN; default. Needs plixkws-base.onnx (exported ONNX).',
  },
  {
    id: 'small',
    label: 'PLiX small (TinyNet-E, 1280-d)',
    onnxUrl: '/modules/kws/plix/assets/plixkws-small.onnx',
    transformersLocalDir: '/modules/kws/plix/assets/hf/plixkws',
    note: 'Lighter / low-RAM. Needs plixkws-small.onnx + plixkws-small.onnx.data (external weights).',
  },
]

/** Look up a variant descriptor by id; undefined for unknown ids. */
export function getPlixEncoderVariant(
  id: 'base' | 'small',
): PlixEncoderVariant | undefined {
  return PLIX_ENCODER_VARIANTS.find((v) => v.id === id)
}

/** Local ONNX URL for a variant (onnx runtime). */
export function plixVariantOnnxUrl(id: 'base' | 'small'): string | undefined {
  return getPlixEncoderVariant(id)?.onnxUrl
}
