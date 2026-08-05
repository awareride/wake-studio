/**
 * sherpa-onnx KWS WebAssembly backend (ADR-020 / docs/kws-categories.md §2.x).
 *
 * This backend performs *direct* keyword spotting with sherpa-onnx's
 * `KeywordSpotter` (a streaming transducer tuned for fixed wake words). The
 * model graph + tokens are prebuilt into the wasm `.data` bundle (see
 * `.github/workflows/build-sherpa-onnx-kws-wasm.yml`); we only point the loader
 * at the wasm glue and supply a keyword list.
 *
 * Loading mirrors the upstream demo (`wasm/kws/app.js`):
 *   1. Inject `sherpa-onnx-kws.js` (defines the `createKws(Module, cfg)` glue).
 *   2. Define a global `Module` whose `onRuntimeInitialized` builds the spotter.
 *   3. Inject `sherpa-onnx-wasm-kws-main.js`, which boots the wasm into that
 *      global `Module` and fires `onRuntimeInitialized`.
 *
 * Per the repo's lazy-asset convention (ADR-011), the ~53 MB wasm bundle is NOT
 * committed; it is fetched into `public/sherpa-onnx-kws/` by
 * `scripts/fetch-sherpa-kws-assets.mjs` (or by importing the CI artifact).
 *
 * Pipeline:
 *   AFE 16 kHz frames -> KeywordSpotter.acceptWaveform
 *   -> (isReady) decode -> getResult -> keyword string
 *   -> score 1.0 on hit (held for the trigger min-duration), else 0.0
 *   -> generic smoother/trigger in the worker (ADR-018).
 */

import type { KWSBackend, SherpaOnnxKwsConfig } from '@wake-studio/module-kws-engine'
import { resolveAsset } from '@wake-studio/platform'

/**
 * Default wasm base URL: the sherpa driver's own assets dir (Q-K2 / ADR-025),
 * base-aware so it survives sub-path deployment (ADR-012). Overridable via
 * config.wasmBaseUrl.
 */
const DEFAULT_WASM_BASE_URL = resolveAsset('/modules/kws/sherpa/assets/sherpa-onnx-kws/')

/**
 * sherpa-onnx KeywordResult JSON shape (the bits we use). When no keyword is
 * active, `keyword` is the empty string.
 */
interface SherpaKeywordResult {
  keyword?: string
  tokens?: string[]
  startTime?: number
  endTime?: number
}

/** The JS object returned by `createKws(Module, config)` (see sherpa-onnx-kws.js). */
interface SherpaKws {
  createStream(): SherpaKwsStream
  isReady(stream: SherpaKwsStream): boolean
  decode(stream: SherpaKwsStream): void
  reset(stream: SherpaKwsStream): void
  getResult(stream: SherpaKwsStream): SherpaKeywordResult
  free(): void
}

interface SherpaKwsStream {
  acceptWaveform(sampleRate: number, samples: Float32Array): void
  free(): void
}

/** Inject a <script> and resolve on load (or immediately if already present). */
function injectScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve()
      return
    }
    const el = document.createElement('script')
    el.src = src
    el.async = true
    el.onload = () => resolve()
    el.onerror = () => reject(new Error(`Failed to load sherpa-onnx KWS script: ${src}`))
    document.head.appendChild(el)
  })
}

/**
 * Boot the sherpa-onnx KWS wasm and build a KeywordSpotter.
 *
 * The build is a *classic* (non-MODULARIZE) emscripten module: it boots into
 * the global `Module` and fires `Module.onRuntimeInitialized`. We mirror the
 * upstream demo (`wasm/kws/app.js`): define a global `Module` with that
 * handler (which builds the spotter via the `createKws` glue), then inject the
 * wasm glue so it fills that global Module and triggers the callback.
 */
async function loadSherpaKws(
  wasmBaseUrl: string,
  config: Record<string, unknown>,
): Promise<SherpaKws> {
  const base = wasmBaseUrl.endsWith('/') ? wasmBaseUrl : `${wasmBaseUrl}/`

  // 1. Glue that defines createKws(Module, cfg) on the global scope.
  await injectScript(`${base}sherpa-onnx-kws.js`)

  const createKws = (globalThis as Record<string, unknown>).createKws
  if (typeof createKws !== 'function') {
    throw new Error('sherpa-onnx-kws glue (createKws) not found.')
  }

  // 2. Boot the wasm. The classic emscripten glue does `var Module = Module || {}`
  //    at eval time, which REASSIGNS globalThis.Module to a fresh object - so we
  //    must NOT pre-attach onRuntimeInitialized (it would be discarded). Instead
  //    we inject the glue (which creates globalThis.Module), then attach the
  //    init callback to that Module. emscripten reads onRuntimeInitialized from
  //    globalThis.Module at call time, so this ordering is what upstream
  //    app.js relies on.
  const ready = new Promise<SherpaKws>((resolve, reject) => {
    const start = Date.now()
    const timer = setInterval(() => {
      if (Date.now() - start > 120000) {
        clearInterval(timer)
        reject(new Error('sherpa-onnx KWS module init timed out.'))
      }
    }, 1000)

    // Attach the init callback to the Module the glue created (poll briefly in
    // case the glue hasn't finished evaluating yet).
    const attach = (): void => {
      const module = (globalThis as Record<string, unknown>).Module as
        | (Record<string, unknown> & { onRuntimeInitialized?: () => void })
        | undefined
      if (module && typeof module.onRuntimeInitialized !== 'function') {
        module.onRuntimeInitialized = () => {
          clearInterval(timer)
          try {
            const spotter = (
              createKws as unknown as (
                m: unknown,
                c: Record<string, unknown>,
              ) => SherpaKws
            )(module, config)
            resolve(spotter)
          } catch (err) {
            reject(err instanceof Error ? err : new Error(String(err)))
          }
        }
      }
    }
    attach()
    const iv = setInterval(attach, 5)
    setTimeout(() => clearInterval(iv), 120000)
  })

  await injectScript(`${base}sherpa-onnx-wasm-kws-main.js`)

  const spotter = await ready
  return spotter
}

const DEFAULT_KEYWORDS = [
  // wenetspeech-3.3M-2024-01-01 keyword tokens (ppinyin + @label).
  'n ǐ h ǎo j ūn g ē :1.5 #0.35 @你好军哥',
  'n ǐ h ǎo w èn w èn :1.5 #0.35 @你好问问',
  'x iǎo ài t óng x ué :1.5 #0.35 @小爱同学',
].join('\n')

export class SherpaOnnxKwsBackend implements KWSBackend {
  readonly id = 'sherpa-onnx-kws' as const
  readonly label = 'sherpa-onnx KWS (direct keyword spotting, transducer)'

  private _cfg: SherpaOnnxKwsConfig = {
    wasmBaseUrl: DEFAULT_WASM_BASE_URL,
    keywords: DEFAULT_KEYWORDS,
    numThreads: 1,
    keywordsThreshold: 0.25,
  }
  private _spotter: SherpaKws | null = null
  private _stream: SherpaKwsStream | null = null
  private _ready = false

  // Hold a detected keyword's high score for enough frames to clear the
  // worker's min-duration trigger window (default 300 ms ~= 30 frames @ 10 ms).
  private _holdFrames = 0
  private _lastKeyword = ''

  get ready(): boolean {
    return this._ready
  }

  configure(cfg: Partial<SherpaOnnxKwsConfig>): void {
    this._cfg = { ...this._cfg, ...cfg }
  }

  async load(_urls: never, _provider: 'webgpu' | 'wasm'): Promise<void> {
    void _urls
    void _provider
    const config: Record<string, unknown> = {
      featConfig: { sampleRate: 16000, featureDim: 80 },
      modelConfig: {
        transducer: {
          encoder: './encoder-epoch-12-avg-2-chunk-16-left-64.onnx',
          decoder: './decoder-epoch-12-avg-2-chunk-16-left-64.onnx',
          joiner: './joiner-epoch-12-avg-2-chunk-16-left-64.onnx',
        },
        tokens: './tokens.txt',
        provider: 'cpu',
        numThreads: this._cfg.numThreads ?? 1,
        debug: 0,
      },
      maxActivePaths: 4,
      numTrailingBlanks: 1,
      keywordsScore: 1.0,
      keywordsThreshold: this._cfg.keywordsThreshold ?? 0.25,
      keywords: this._cfg.keywords ?? DEFAULT_KEYWORDS,
    }

    this._spotter = await loadSherpaKws(
      this._cfg.wasmBaseUrl,
      config,
    )
    this._stream = this._spotter.createStream()
    this._ready = true
  }

  async processFrame(samples: Float32Array): Promise<number | null> {
    if (!this._ready || !this._spotter || !this._stream) return null

    this._stream.acceptWaveform(16000, samples)

    // Keep a detected high score "held" for the trigger min-duration window so
    // a single-frame hit reliably crosses the threshold + min-duration gate.
    if (this._holdFrames > 0) {
      this._holdFrames -= 1
      return 1
    }

    if (!this._spotter.isReady(this._stream)) return 0

    this._spotter.decode(this._stream)
    const result = this._spotter.getResult(this._stream)
    this._spotter.reset(this._stream)

    const keyword = (result.keyword ?? '').trim()
    if (keyword.length > 0) {
      this._lastKeyword = keyword
      // Hold high for ~400 ms (40 frames) to satisfy min-duration + cooldown.
      this._holdFrames = 40
      return 1
    }
    return 0
  }

  /** The most recently detected keyword (for the panel's live view). */
  get lastPartialText(): string {
    return this._lastKeyword
  }

  reset(): void {
    if (this._spotter && this._stream) {
      try {
        this._spotter.reset(this._stream)
      } catch {
        /* ignore */
      }
    }
    this._holdFrames = 0
  }

  async dispose(): Promise<void> {
    this.reset()
    if (this._spotter && this._stream) {
      try {
        this._stream.free()
        this._spotter.free()
      } catch {
        /* ignore */
      }
    }
    this._spotter = null
    this._stream = null
    this._ready = false
  }
}
