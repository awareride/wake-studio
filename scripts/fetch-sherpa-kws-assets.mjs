#!/usr/bin/env node
/**
 * Download the sherpa-onnx KWS WebAssembly runtime into `public/sherpa-onnx-kws/`
 * so WakeStudio can run direct keyword spotting in the browser (ADR-011).
 *
 * The build is produced by `.github/workflows/build-sherpa-onnx-kws-wasm.yml`
 * and published as the `sherpa-onnx-kws-wasm` artifact. This script fetches the
 * artifact from a GitHub Actions run (or a local path) and unpacks the wasm
 * glue + `.wasm` + `.data` into `public/sherpa-onnx-kws/`.
 *
 * Per the repo's lazy-asset convention the ~53 MB bundle is NOT committed; it
 * is fetched on demand (dev / CI prebuild) and gitignored.
 *
 * Usage:
 *   node scripts/fetch-sherpa-kws-assets.mjs
 *
 * Env (optional):
 *   KWS_WASM_ARTIFACT_DIR  path to an already-downloaded artifact directory
 *                          (skips the GitHub download). Useful in CI where the
 *                          artifact is fetched by `actions/download-artifact`.
 *   GITHUB_REPO           owner/name to pull the artifact from (default: the
 *                          repo this script lives in, via git remote).
 */

import { mkdirSync, existsSync, statSync, copyFileSync, readdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PUBLIC_DIR = resolve(__dirname, '..', 'public', 'sherpa-onnx-kws')

// Files the browser needs (the model graph + tokens are preloaded into .data).
const WASM_FILES = [
  'sherpa-onnx-wasm-kws-main.js',
  'sherpa-onnx-wasm-kws-main.wasm',
  'sherpa-onnx-wasm-kws-main.data',
  'sherpa-onnx-kws.js',
]

function run(cmd, args, opts = {}) {
  const out = spawnSync(cmd, args, { stdio: 'inherit', ...opts })
  if (out.status !== 0) {
    throw new Error(`Command failed (${out.status}): ${cmd} ${args.join(' ')}`)
  }
}

/** Resolve the current repo's owner/name from the git remote. */
function defaultRepo() {
  const out = spawnSync('git', ['config', '--get', 'remote.origin.url'], {
    encoding: 'utf8',
  })
  const url = (out.stdout || '').trim()
  const m = url.match(/[:/]([^/]+\/[^/]+?)(?:\.git)?$/)
  return m ? m[1] : 'awareride/wake-studio'
}

async function main() {
  mkdirSync(PUBLIC_DIR, { recursive: true })

  const localDir = process.env.KWS_WASM_ARTIFACT_DIR
  if (localDir && existsSync(localDir)) {
    console.log(`Using local artifact dir: ${localDir}`)
    copyFrom(localDir)
    return
  }

  // Otherwise download the latest successful run's artifact via gh.
  const repo = process.env.GITHUB_REPO || defaultRepo()
  console.log(`Fetching sherpa-onnx KWS wasm artifact from ${repo} ...`)
  const tmp = resolve(PUBLIC_DIR, '..', '.kws-wasm-artifact')
  mkdirSync(tmp, { recursive: true })

  run('gh', [
    'run',
    'download',
    '--repo',
    repo,
    '--name',
    'sherpa-onnx-kws-wasm',
    '--dir',
    tmp,
  ])

  copyFrom(tmp)
  console.log('Done. sherpa-onnx KWS wasm is in public/sherpa-onnx-kws/')
}

function copyFrom(srcDir) {
  const entries = readdirSync(srcDir)
  // The artifact may be nested one directory deep (e.g. install/bin/wasm).
  const findFile = (name) => {
    if (existsSync(resolve(srcDir, name))) return resolve(srcDir, name)
    for (const e of entries) {
      const cand = resolve(srcDir, e, name)
      if (existsSync(cand)) return cand
    }
    return null
  }
  for (const f of WASM_FILES) {
    const src = findFile(f)
    if (!src) {
      console.warn(`Warning: ${f} not found in artifact; skipping.`)
      continue
    }
    copyFileSync(src, resolve(PUBLIC_DIR, f))
    console.log(`  ok (${statSync(src).size} bytes): ${f}`)
  }
}

main().catch((err) => {
  console.error('fetch-sherpa-kws-assets failed:', err.message)
  console.error('\nManual steps: download the `sherpa-onnx-kws-wasm` artifact from')
  console.error('Actions -> Build sherpa-onnx KWS WASM, extract it, and copy')
  console.error('sherpa-onnx-wasm-kws-main.{js,wasm,data} + sherpa-onnx-kws.js')
  console.error('into public/sherpa-onnx-kws/.')
  process.exit(1)
})
