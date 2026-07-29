/**
 * sherpa-onnx WebAssembly loader for the browser (ASR-Decoding KWS).
 *
 * sherpa-onnx's npm package is the *Node.js* build (CommonJS + a Node wasm).
 * For the browser we need the **wasm build** (`sherpa-onnx-wasm-main-asr.js`
 * + `sherpa-onnx-wasm-main-asr.wasm` + `sherpa-onnx-asr.js`). Per the decoupling
 * rule and the repo's lazy-asset convention (ADR-011), we load these at runtime
 * from a configurable base URL (default `/sherpa-onnx/`, i.e. `public/sherpa-onnx/`)
 * and never bundle the ~11 MB wasm.
 *
 * The glue script is a UMD/Emscripten module factory. We inject it as a
 * `<script>` so it boots its WASM; it attaches a global factory (configurable
 * name) we then call. The model files (encoder/decoder/joiner/tokens) are
 * fetched by sherpa-onnx itself from `modelBaseUrl`.
 *
 * Asset download is provided by `scripts/fetch-sherpa-assets.mjs` (documents
 * the exact release + license, Apache-2.0). Until those assets are present the
 * backend surfaces a clear "assets missing" error rather than silently failing.
 */

/** The global factory name the Emscripten glue attaches. */
const SHERPA_GLOBAL = 'createSherpaOnnxAsr'

export interface LoadedSherpa {
  /** The booted WASM module (with createOnlineRecognizer etc. available). */
  Module: unknown
  /** Factory: create an OnlineRecognizer from a config object. */
  createOnlineRecognizer: (config: unknown) => SherpaOnlineRecognizer
}

export interface SherpaOnlineRecognizer {
  /** Accept a 16 kHz mono waveform chunk (Float32 in [-1,1]). */
  acceptWaveform(session: unknown, sampleRate: number, samples: Float32Array): void
  /** Decode the current chunk and return the partial result string. */
  getResult(session: unknown): { text: string }
  /** Whether the recognizer has detected an endpoint. */
  isEndpoint(session: unknown): boolean
  /** Reset the recognizer state for the next segment. */
  reset(session: unknown): void
  /** Create a streaming decode session. */
  createStream(session?: unknown): unknown
  /** Free the recognizer + session. */
  free(recognizer: unknown): void
  freeStream?(session: unknown): void
}

let _cached: LoadedSherpa | null = null

/** Append a <script> tag and resolve when it finishes loading. */
function injectScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`)
    if (existing) {
      resolve()
      return
    }
    const el = document.createElement('script')
    el.src = src
    el.async = true
    el.onload = () => resolve()
    el.onerror = () => reject(new Error(`Failed to load sherpa-onnx script: ${src}`))
    document.head.appendChild(el)
  })
}

/**
 * Load the sherpa-onnx ASR runtime from `wasmBaseUrl`. Safe to call repeatedly;
 * the runtime is cached.
 */
export async function loadSherpaAsr(wasmBaseUrl: string): Promise<LoadedSherpa> {
  if (_cached) return _cached
  const base = wasmBaseUrl.endsWith('/') ? wasmBaseUrl : `${wasmBaseUrl}/`

  // The glue script boots WASM; it expects to find the .wasm next to it.
  await injectScript(`${base}sherpa-onnx-wasm-main-asr.js`)
  await injectScript(`${base}sherpa-onnx-asr.js`)

  // Emscripten glue usually attaches a factory on `window` (MODULARIZE + EXPORT_NAME).
  // We accept either a global factory function or an object exposing the API.
  const factory = (globalThis as Record<string, unknown>)[SHERPA_GLOBAL]
  if (typeof factory !== 'function' && typeof factory !== 'object') {
    throw new Error(
      'sherpa-onnx ASR assets not found. Run `node scripts/fetch-sherpa-assets.mjs` ' +
        `to download the wasm + ASR glue into ${base} (Apache-2.0).`,
    )
  }
  _cached = factory as unknown as LoadedSherpa
  return _cached
}

/** Build a sherpa-onnx OnlineRecognizer config for a streaming transducer model. */
export function buildOnlineConfig(modelBaseUrl: string, beamSize: number): unknown {
  const dir = modelBaseUrl.endsWith('/') ? modelBaseUrl : `${modelBaseUrl}/`
  return {
    modelConfig: {
      transducer: {
        encoder: `${dir}encoder.onnx`,
        decoder: `${dir}decoder.onnx`,
        joiner: `${dir}joiner.onnx`,
      },
      tokens: `${dir}tokens.txt`,
      numThreads: 1,
    },
    decoderConfig: {
      decodingMethod: 'greedy_search',
      beamSize,
    },
    enableEndpoint: true,
    // Endpoint detection: ~0.4s trailing silence ends a segment.
    rule1MinTrailingSilence: 0.4,
    rule2MinTrailingSilence: 0.8,
    rule3MinUtteranceLength: 1.5,
  }
}
