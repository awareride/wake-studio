#!/usr/bin/env node
/**
 * Publish runtime assets to Cloudflare R2 (ADR-046).
 *
 * In `VITE_ASSETS_MODE=external` builds the heavy assets are not copied into
 * `dist/`; they live in the private R2 bucket bound to the Pages project and
 * are served same-origin by `apps/web/functions/{modules,ort}`. This script
 * uploads them with object keys that mirror the URL paths, so the Functions
 * can map `/<prefix>/<rest>` to `<prefix>/<rest>` unchanged:
 *
 *   packages/modules/<category>/<module>/assets/<rel>
 *     -> modules/<category>/<module>/assets/<rel>
 *   onnxruntime-web dist (ort-wasm-simd-threaded*.{wasm,mjs})
 *     -> ort/<file>
 *
 * The upload uses the same Cloudflare REST endpoint wrangler's
 * `r2 object put` uses (`PUT /accounts/:id/r2/buckets/:bucket/objects/:key`)
 * with a streamed body, so no wrangler dependency is needed.
 *
 * Usage:
 *   node scripts/publish-r2.mjs [--bucket <name>] [--concurrency <n>] [--dry-run]
 *
 * Env:
 *   CLOUDFLARE_API_TOKEN   token with "Workers R2 Storage: Edit"
 *   CLOUDFLARE_ACCOUNT_ID  account id
 *   R2_BUCKET              bucket name (default: wake-studio-assets)
 */

import { createReadStream, readdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, extname, join, relative, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'

const repoRoot = resolve(import.meta.dirname, '..')
const DEFAULT_BUCKET = 'wake-studio-assets'
const API_BASE = 'https://api.cloudflare.com/client/v4'
/** Mirrors ASSET_CACHE_CONTROL in apps/web/functions/_lib/r2-assets.ts. */
const CACHE_CONTROL = 'public, max-age=0, must-revalidate'

/**
 * Extension -> MIME map. The Functions prefer the content type stored in the
 * object's HTTP metadata (which this script sets) and fall back to their own
 * copy of this map; keep the two in sync (r2-assets.ts).
 */
const CONTENT_TYPES = {
  '.onnx': 'application/octet-stream',
  '.data': 'application/octet-stream',
  '.tflite': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.mjs': 'text/javascript',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.wav': 'audio/wav',
}

function die(msg) {
  console.error(`[publish-r2] ${msg}`)
  process.exit(1)
}

function readdirSafe(dir) {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

function isDir(p) {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

function contentTypeFor(file) {
  return CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream'
}

/** Recursively collect non-dot files under a dir (skips .gitkeep and friends). */
function walkFiles(root, onFile) {
  for (const entry of readdirSafe(root)) {
    if (entry.startsWith('.')) continue
    const p = join(root, entry)
    if (isDir(p)) walkFiles(p, onFile)
    else onFile(p)
  }
}

/**
 * Module-owned assets: packages/modules/<category>/<module>/assets/**.
 * Mirrors the walk in apps/web/vite.config.ts `copyModuleAssets()` (ADR-025).
 */
function collectModuleAssets() {
  const entries = []
  const modulesRoot = join(repoRoot, 'packages', 'modules')
  for (const category of readdirSafe(modulesRoot)) {
    const catDir = join(modulesRoot, category)
    if (!isDir(catDir)) continue
    for (const mod of readdirSafe(catDir)) {
      const assetsDir = join(catDir, mod, 'assets')
      if (!isDir(assetsDir)) continue
      walkFiles(assetsDir, (file) => {
        const rel = relative(assetsDir, file).split(sep).join('/')
        entries.push({
          key: `modules/${category}/${mod}/assets/${rel}`,
          file,
        })
      })
    }
  }
  return entries
}

/**
 * The vendored onnxruntime-web dist dir.
 *
 * Resolve through a module that depends on onnxruntime-web first: the app
 * bundles that pnpm-linked version, so the published wasm/loaders must match
 * it (the pnpm store may also hold another version pulled by an optional
 * dependency, e.g. @huggingface/transformers). Fall back to a store scan.
 */
function findOrtDist() {
  try {
    const require = createRequire(
      join(repoRoot, 'packages', 'modules', 'kws', 'openwakeword', 'package.json'),
    )
    const dist = dirname(require.resolve('onnxruntime-web'))
    if (isDir(dist)) return dist
  } catch {
    // fall through to the store scan
  }
  const pnpmRoot = join(repoRoot, 'node_modules', '.pnpm')
  for (const v of readdirSafe(pnpmRoot)) {
    if (!v.startsWith('onnxruntime-web@')) continue
    const cand = join(pnpmRoot, v, 'node_modules', 'onnxruntime-web', 'dist')
    if (isDir(cand)) return cand
  }
  return null
}

/** ORT files the build would copy into dist/ort (P0-4). */
function collectOrtAssets() {
  const dist = findOrtDist()
  if (!dist) return []
  return readdirSafe(dist)
    .filter(
      (f) =>
        f.startsWith('ort-wasm-simd-threaded') &&
        (f.endsWith('.wasm') || f.endsWith('.mjs')),
    )
    .map((f) => ({ key: `ort/${f}`, file: join(dist, f) }))
}

function collectEntries() {
  const entries = [...collectModuleAssets(), ...collectOrtAssets()]
  return entries.map((e) => ({ ...e, size: statSync(e.file).size }))
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${bytes} B`
}

/** Upload one object; retries transient failures (network / 429 / 5xx). */
async function putObject({ accountId, token, bucket, entry, attempts = 3 }) {
  const keyPath = entry.key.split('/').map(encodeURIComponent).join('/')
  const url = `${API_BASE}/accounts/${accountId}/r2/buckets/${encodeURIComponent(bucket)}/objects/${keyPath}`

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': contentTypeFor(entry.file),
          'content-length': String(entry.size),
          'cache-control': CACHE_CONTROL,
        },
        body: Readable.toWeb(createReadStream(entry.file)),
        duplex: 'half',
      })
      if (res.ok) return
      const detail = (await res.text()).slice(0, 300)
      const transient = res.status === 429 || res.status >= 500
      if (!transient || attempt === attempts) {
        die(`upload failed (HTTP ${res.status}) for ${entry.key}: ${detail}`)
      }
      console.warn(
        `[publish-r2] ${entry.key}: HTTP ${res.status}, retrying (${attempt}/${attempts})`,
      )
    } catch (err) {
      if (attempt === attempts) {
        die(`upload failed for ${entry.key}: ${err instanceof Error ? err.message : err}`)
      }
      console.warn(
        `[publish-r2] ${entry.key}: ${err instanceof Error ? err.message : err}, retrying (${attempt}/${attempts})`,
      )
    }
    await new Promise((r) => setTimeout(r, 500 * attempt))
  }
}

/** Run `worker` over `items` with a fixed concurrency. */
async function runPool(items, concurrency, worker) {
  let next = 0
  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (next < items.length) {
        const item = items[next++]
        await worker(item)
      }
    },
  )
  await Promise.all(runners)
}

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const flagValue = (name) => {
    const i = args.indexOf(name)
    return i >= 0 ? args[i + 1] : undefined
  }
  const bucket = flagValue('--bucket') || process.env.R2_BUCKET || DEFAULT_BUCKET
  const concurrency = Number(flagValue('--concurrency') ?? 4)
  if (!Number.isFinite(concurrency) || concurrency < 1) {
    die('--concurrency must be a positive number')
  }

  const entries = collectEntries()
  if (entries.length === 0) {
    die(
      'no assets found — run `pnpm fetch:all` first (and `pnpm install` for the ' +
        'onnxruntime-web runtime)',
    )
  }

  const totalBytes = entries.reduce((n, e) => n + e.size, 0)
  console.log(
    `[publish-r2] ${entries.length} objects -> bucket "${bucket}" (${formatBytes(totalBytes)})`,
  )
  for (const entry of entries) {
    console.log(`  ${entry.key} (${formatBytes(entry.size)})`)
  }
  if (dryRun) {
    console.log('[publish-r2] dry run: nothing uploaded')
    return
  }

  const token = process.env.CLOUDFLARE_API_TOKEN
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
  if (!token) die('CLOUDFLARE_API_TOKEN is not set')
  if (!accountId) die('CLOUDFLARE_ACCOUNT_ID is not set')

  await runPool(entries, concurrency, async (entry) => {
    await putObject({ accountId, token, bucket, entry })
    console.log(`  ok  ${entry.key}`)
  })
  console.log(`[publish-r2] done: ${entries.length} objects in "${bucket}"`)
}

main()
