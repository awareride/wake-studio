/**
 * kws-sherpa driver module - L2 wasm-runtime test (ADR-026).
 *
 * Intended: load the sherpa-onnx KWS emscripten bundle IN NODE and verify the
 * wasm boots + a KeywordSpotter can be created (the "artifact boots" gate that
 * runs on every PR without a browser).
 *
 * STATUS (2026-08-08, #49 fixed): the browser-targeted emscripten build boots
 * in Node once the vm context provides the globals the glue branches on.
 * Root cause: ENVIRONMENT_IS_NODE keys off the bare `process` identifier;
 * the sandbox did not provide it, so the glue took the browser path and hung
 * on fetch() for the .data package. With `process` (+ performance/
 * TextDecoder/TextEncoder/URL) in the sandbox, the glue's isNode path reads
 * the wasm + .data via fs.readFileSync — the same artifact the browser uses.
 *
 * The suite runs whenever the artifact is present (gitignored per ADR-011;
 * fetch with `pnpm fetch:all`) and skips otherwise, so CI stays green even
 * when the artifact has not been fetched.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const bundleDir = resolve(here, '../assets/sherpa-onnx-kws')
const gluePath = resolve(bundleDir, 'sherpa-onnx-kws.js')
const mainPath = resolve(bundleDir, 'sherpa-onnx-wasm-kws-main.js')

const ASSETS_PRESENT = existsSync(gluePath) && existsSync(mainPath)
// #49 fixed: runs whenever the artifact is present (see header).

// Mirror the browser backend's config (core/backend.ts load()): the .data
// package mounts the epoch-13 model files + tokens.txt at the FS root, so the
// relative './...' paths resolve against cwd '/' in the emscripten FS. #49.
const SHERPA_CONFIG = {
  featConfig: { sampleRate: 16000, featureDim: 80 },
  modelConfig: {
    transducer: {
      encoder: './encoder-epoch-13-avg-2-chunk-16-left-64.onnx',
      decoder: './decoder-epoch-13-avg-2-chunk-16-left-64.onnx',
      joiner: './joiner-epoch-13-avg-2-chunk-16-left-64.onnx',
    },
    tokens: './tokens.txt',
    provider: 'cpu',
    numThreads: 1,
    debug: 0,
  },
  maxActivePaths: 4,
  numTrailingBlanks: 1,
  keywordsScore: 1.0,
  keywordsThreshold: 0.25,
  keywords: 'x iǎo ài t óng x ué @小爱同学',
}

// The emscripten glue is CommonJS-flavored (references `module`/`require` at
// eval time). vitest runs ESM, so bare eval would hit `ReferenceError: module
// is not defined`. Run the glue in a dedicated vm context that shares
// globalThis (so createKws / Module land where bootSpotter reads them) and
// provides CJS `module`/`exports`/`require`/`__dirname` shims without
// polluting the module scope's global identifiers.
const cjsRequire = createRequire(import.meta.url)
const cjsGlobals = {
  module: { exports: {} },
  exports: {} as Record<string, unknown>,
  require: cjsRequire,
  __dirname: here,
}
const vmContext = vm.createContext({
  ...cjsGlobals,
  globalThis,
  console,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  // Node globals the emscripten glue branches on or calls at runtime. The
  // bare `process` identifier selects the ENVIRONMENT_IS_NODE path (fs-based
  // readAsync + .data load); without it the glue hangs on the browser
  // fetch() path. The rest are runtime calls (clock, string codecs). #49.
  process,
  performance,
  TextDecoder,
  TextEncoder,
  URL,
})

/** Evaluate an emscripten glue file in the vm context (Node). */
function evalGlobal(src: string): void {
  vm.runInContext(src, vmContext, { filename: 'sherpa-glue.js' })
}

/** Boot the wasm in Node and resolve with a ready KeywordSpotter. */
async function bootSpotter(): Promise<unknown> {
  // Step 1: the createKws glue. In a browser script the top-level function
  // declaration lands on the global scope; in the vm context it attaches to
  // the sandbox global, and its CJS branch (typeof process == 'object') also
  // sets module.exports. Read from both. #49.
  evalGlobal(readFileSync(gluePath, 'utf8'))
  const sandbox = vmContext as Record<string, unknown>
  const createKws =
    (cjsGlobals.module.exports as Record<string, unknown>).createKws ??
    sandbox.createKws
  if (typeof createKws !== 'function') {
    throw new Error('sherpa-onnx-kws glue (createKws) not found after eval')
  }

  // Step 2: pre-set locateFile so the main glue's PACKAGE_NAME .data fetch
  // resolves to the flat bundle dir (same trick as the browser backend).
  const g = globalThis as Record<string, unknown>
  const existing = (g.Module as Record<string, unknown> | undefined) ?? {}
  existing.locateFile = (path: string) => {
    const name = path.split('/').pop() ?? path
    return `${bundleDir}/${name}`
  }
  g.Module = existing
  // The glue reads the bare `Module` identifier, which resolves against the
  // vm sandbox global (not the outer globalThis), so mirror the browser
  // backend by putting Module on the sandbox as well. #49.
  sandbox.Module = existing

  // Step 3: attach onRuntimeInitialized, then run the main glue (auto-runs).
  const ready = new Promise<unknown>((resolveReady, reject) => {
    const timer = setTimeout(() => reject(new Error('sherpa boot timed out')), 25_000)
    const attach = (): void => {
      // Explicit annotation: `g.Module` is unknown; narrow to the emscripten
      // Module shape (has onRuntimeInitialized). A plain `as` cast on an
      // `unknown`-typed property can be widened to `number` by TS when the
      // lib includes Node's `Module` global type, so be explicit.
      const mod: (Record<string, unknown> & { onRuntimeInitialized?: () => void }) | undefined =
        g.Module as Record<string, unknown> & { onRuntimeInitialized?: () => void }
      if (mod && typeof mod.onRuntimeInitialized !== 'function') {
        mod.onRuntimeInitialized = () => {
          clearTimeout(timer)
          try {
            resolveReady(
              (createKws as (m: unknown, c: Record<string, unknown>) => unknown)(
                mod,
                SHERPA_CONFIG,
              ),
            )
          } catch (err) {
            reject(err instanceof Error ? err : new Error(String(err)))
          }
        }
      }
    }
    attach()
    const iv = setInterval(attach, 5)
    setTimeout(() => clearInterval(iv), 25_000)
  })

  evalGlobal(readFileSync(mainPath, 'utf8'))
  return ready
}

describe.skipIf(!ASSETS_PRESENT)('sherpa-onnx-kws wasm runtime (L2, Node)', () => {
  let spotter: { createStream: () => unknown; isReady: (s: unknown) => boolean; decode: (s: unknown) => void; getResult: (s: unknown) => { keyword?: string } } | null = null

  beforeAll(async () => {
    spotter = (await bootSpotter()) as typeof spotter
  }, 40_000)

  it('boots the wasm and creates a KeywordSpotter', () => {
    expect(spotter).toBeTruthy()
    expect(typeof spotter?.createStream).toBe('function')
  })

  it('accepts a synthetic 16 kHz clip and decodes without throwing', () => {
    const stream = spotter!.createStream()
    // 0.5 s of a 440 Hz sine: longer than one encoder chunk (chunk-16 =
    // 160 ms @ 10 ms/frame), so the stream becomes ready. The browser backend
    // only decodes ready chunks (core/backend.ts processFrame loop).
    const samples = new Float32Array(8000)
    for (let i = 0; i < samples.length; i++) {
      samples[i] = Math.sin((2 * Math.PI * 440 * i) / 16000) * 0.5
    }
    ;(stream as { acceptWaveform: (sr: number, s: Float32Array) => void }).acceptWaveform(16000, samples)
    let decodedChunks = 0
    while (spotter!.isReady(stream)) {
      expect(() => spotter!.decode(stream)).not.toThrow()
      decodedChunks += 1
    }
    // The stream actually produced ready chunks (guard against a silent
    // no-op where nothing was ever decoded).
    expect(decodedChunks).toBeGreaterThan(0)
    const result = spotter!.getResult(stream)
    // No wake word in a pure sine; keyword should be empty, not an error.
    expect(result).toBeTruthy()
    expect(typeof result.keyword).toBe('string')
  })
})
