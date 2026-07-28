#!/usr/bin/env node
/**
 * Download sherpa-onnx WebAssembly assets + a default streaming ASR model for
 * the ASR-Decoding KWS backend (docs/kws-categories.md §2.2, ADR-024).
 *
 * Why this exists:
 *   The `sherpa-onnx` npm package is the *Node.js* build (CommonJS + a Node
 *   wasm). For the browser we need the **wasm build** (`sherpa-onnx-wasm-main-asr.js`
 *   + `.wasm` + `sherpa-onnx-asr.js`), which is published as GitHub release
 *   assets by k2-fsa. Per the repo's lazy-asset convention (ADR-011) we do NOT
 *   bundle these ~11 MB files - we fetch them on demand into `public/sherpa-onnx/`
 *   so the PWA can serve them locally (and they survive a deploy because they
 *   live under `public/`).
 *
 * License:
 *   sherpa-onnx is Apache-2.0. The default model below
 *   (sherpa-onnx-streaming-zipformer-en-20M-2023-02-17) is Apache-2.0.
 *
 * Usage:
 *   node scripts/fetch-sherpa-assets.mjs
 *
 * Set SHERPA_WASM_VERSION to pin a different sherpa-onnx release tag.
 */

import { mkdirSync, createWriteStream, existsSync, statSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { pipeline } from 'node:stream/promises'
import { get } from 'node:https'
import { get as httpGet } from 'node:http'
import { URL } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PUBLIC_DIR = resolve(__dirname, '..', 'public', 'sherpa-onnx')
const MODELS_DIR = resolve(PUBLIC_DIR, 'models', 'asr')

// sherpa-onnx release tag whose wasm assets we download.
const SHERPA_VERSION = process.env.SHERPA_WASM_VERSION || 'v1.13.4'

// Base of the GitHub release assets for that tag.
const RELEASE_BASE = `https://github.com/k2-fsa/sherpa-onnx/releases/download/${SHERPA_VERSION}`

// WASM runtime files (needed by the browser glue).
const WASM_FILES = [
  'sherpa-onnx-wasm-main-asr.js',
  'sherpa-onnx-wasm-main-asr.wasm',
  'sherpa-onnx-asr.js',
]

// Default English streaming transducer model (Apache-2.0).
const MODEL_TAR = 'sherpa-onnx-streaming-zipformer-en-20M-2023-02-17.tar.bz2'
const MODEL_RELEASE_URL = `https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/${MODEL_TAR}`

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? get : httpGet
    lib(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location).then(resolve, reject)
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`))
        return
      }
      resolve(res)
    }).on('error', reject)
  })
}

async function downloadFile(url, dest) {
  if (existsSync(dest) && statSync(dest).size > 0) {
    console.log(`  skip (exists): ${dest.replace(PUBLIC_DIR, '.')}`)
    return
  }
  const res = await fetchUrl(url)
  await pipeline(res, createWriteStream(dest))
  const size = statSync(dest).size
  console.log(`  ok (${size} bytes): ${dest.replace(PUBLIC_DIR, '.')}`)
}

async function extractTarBz2(tarPath, destDir) {
  // Use system `tar` (bzip2) - available on macOS/Linux; Windows users can use
  // WSL or 7-zip. This keeps the script dependency-free.
  const { spawnSync } = await import('node:child_process')
  const out = spawnSync('tar', ['xjf', tarPath, '-C', destDir], {
    stdio: 'inherit',
  })
  if (out.status !== 0) {
    throw new Error(
      'Failed to extract model archive. Install `tar` (with bzip2) or extract ' +
        `${tarPath} manually into ${destDir}.`,
    )
  }
  // The archive expands into a subdirectory; flatten the known files we need.
  const { readdirSync, renameSync, rmSync } = await import('node:fs')
  const entries = readdirSync(destDir)
  const sub = entries.find((e) => statSync(resolve(destDir, e)).isDirectory())
  if (sub) {
    const subDir = resolve(destDir, sub)
    for (const f of ['encoder.onnx', 'decoder.onnx', 'joiner.onnx', 'tokens.txt']) {
      const from = resolve(subDir, f)
      if (existsSync(from)) renameSync(from, resolve(destDir, f))
    }
    rmSync(subDir, { recursive: true, force: true })
  }
}

async function main() {
  console.log(`Fetching sherpa-onnx assets (${SHERPA_VERSION}) into public/sherpa-onnx/`)
  mkdirSync(PUBLIC_DIR, { recursive: true })
  mkdirSync(MODELS_DIR, { recursive: true })

  for (const f of WASM_FILES) {
    await downloadFile(`${RELEASE_BASE}/${f}`, resolve(PUBLIC_DIR, f))
  }

  console.log('Fetching default English streaming ASR model…')
  const tarPath = resolve(MODELS_DIR, MODEL_TAR)
  await downloadFile(MODEL_RELEASE_URL, tarPath)
  console.log('Extracting model…')
  await extractTarBz2(tarPath, MODELS_DIR)
  console.log('Done. ASR-Decoding KWS is ready to load in the browser.')

  // Sanity: ensure the four model files landed.
  const needed = ['encoder.onnx', 'decoder.onnx', 'joiner.onnx', 'tokens.txt']
  const missing = needed.filter((f) => !existsSync(resolve(MODELS_DIR, f)))
  if (missing.length) {
    console.warn(`Warning: missing model files: ${missing.join(', ')}`)
  }
}

main().catch((err) => {
  console.error('fetch-sherpa-assets failed:', err.message)
  console.error('\nManual steps: download the three wasm files from')
  console.error(`${RELEASE_BASE}/`)
  console.error('and the model from')
  console.error(MODEL_RELEASE_URL)
  console.error('into public/sherpa-onnx/ and public/sherpa-onnx/models/asr/ respectively.')
  process.exit(1)
})
