/**
 * Minimal ambient declaration for `@huggingface/transformers` (v4 browser build).
 *
 * This package is an **optional**, dynamically-imported dependency (only when the
 * PLiX `transformers` runtime is selected). It is intentionally NOT a hard
 * `dependency` so the default ONNX path does not require it. Because it may
 * not be installed in every environment, we declare a small ambient module here
 * rather than relying on its (heavy) bundled types. The dynamic `import()`
 * returns an untyped object we narrow locally in `plix-transformers.ts`.
 *
 * Only the members we actually use are declared:
 *   - `AutoModel.from_pretrained(idOrPath, opts?)` -> a model whose `call()` /
 *     `(input)` runs ONNX inference (it wraps onnxruntime-web internally).
 *   - `env` - runtime settings (WASM paths, remote-model toggle).
 *   - `Tensor` - the onnxruntime-web tensor we feed the 1x64x100 log-Mel image.
 *
 * @see src/kws/backends/plix-transformers.ts
 * @see docs/Technical Reference_ Resource Requirements and Zero-Python
 *      Deployment Strategies for WavLM-base-plus and plixkws.md §3.1
 */

declare module '@huggingface/transformers' {
  /** onnxruntime-web-style tensor (what the model consumes / returns). */
  export class Tensor {
    constructor(type: string, data: Float32Array | number[], dims: number[])
    data: Float32Array
    dims: number[]
  }

  /** A loaded model; calling it runs a forward pass and returns { last_hidden_state? | ... }. */
  export interface TransformersModel {
    (input: Tensor, ...args: unknown[]): Promise<{ last_hidden_state?: Tensor } & Record<string, Tensor>>
  }

  export interface PretrainedOptions {
    dtype?: string
    device?: string
    [key: string]: unknown
  }

  export interface AutoModelStatic {
    from_pretrained(
      modelIdOrPath: string,
      options?: PretrainedOptions,
    ): Promise<TransformersModel>
  }

  export const AutoModel: AutoModelStatic

  /** Runtime environment (WASM paths, remote-model toggle). */
  export interface TransformersEnv {
    allowRemoteModels: boolean
    localModelPath?: string
    backends?: {
      onnx?: {
        wasm?: {
          wasmPaths?: string
          numThreads?: number
        }
      }
    }
    [key: string]: unknown
  }

  export const env: TransformersEnv
}
