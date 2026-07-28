/**
 * PLiX encoder runtime interface (ADR-002).
 *
 * A PLiX encoder turns a 16 kHz mono clip into a 1280-dim embedding; the
 * Few-Shot backend then scores it against an enrolled prototype. PLiX can be
 * served by more than one runtime, and the choice depends on the deployment:
 *
 *   - 'onnx'        -> onnxruntime-web (default). Needs an exported
 *                       `plixkws-*.onnx` file (see scripts/export-plixkws-onnx.py).
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

import type { ModelRuntime } from '../../runtime'

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
