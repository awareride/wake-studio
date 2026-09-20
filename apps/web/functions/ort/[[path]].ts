/**
 * `/ort/...` -> R2 `ort/...` (ADR-046).
 *
 * The vendored onnxruntime-web wasm runtime (`ort-wasm-simd-threaded*.wasm` +
 * `.mjs` loaders) is published to R2 and served same-origin from here in
 * `VITE_ASSETS_MODE=external` builds; `ort.env.wasm.wasmPaths` is already
 * `/ort/` (P0-4), so the runtime is unaware of the origin.
 */

import { serveAsset } from '../_lib/r2-assets'
import type { CatchAllPagesContext } from '../_lib/r2-types'

export const onRequest = (context: CatchAllPagesContext): Promise<Response> =>
  serveAsset(context.request, context.env, 'ort', context.params.path)
