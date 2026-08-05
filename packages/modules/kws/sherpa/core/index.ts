/**
 * kws-sherpa driver module - core exports.
 * Driver boundary stub; the sherpa-onnx KWS backend engine lands in
 * module-migration §6.3 (moved from apps/web/src/kws/backends/).
 */

export const SHERPA_WASM_ASSETS_DIR = 'assets/sherpa-onnx-kws'

export interface SherpaKwsDriverOptions {
  /** Base-path-resolved URL prefix for the wasm glue + model files. */
  wasmBaseUrl: string
}
