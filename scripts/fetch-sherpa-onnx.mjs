#!/usr/bin/env node
/**
 * Fetch the pinned sherpa-onnx prebuilt C API (issue #193; ASR-Decoding
 * device driver, kws/sherpa).
 *
 * sherpa-onnx is a live upstream project (ADR-037 Tier 1-2): we pin a release
 * (ADR-031 style) instead of vendoring source. The official release tarballs
 * ship the C API headers + shared library (which bundles its own
 * onnxruntime); this script downloads the platform tarball for the current
 * host, verifies its sha256, and extracts it to
 * third_party/sherpa-onnx/<host> (gitignored — fetched, never committed).
 *
 * Usage:
 *   node scripts/fetch-sherpa-onnx.mjs            # detect host
 *   node scripts/fetch-sherpa-onnx.mjs --force    # re-fetch even if present
 *
 * Pinned: SHERPA_VERSION + per-platform sha256 below. When bumping, update
 * both (sha256sum of the release tarball).
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { spawnSync } from 'node:child_process'

const VERSION = '1.13.6'
const BASE = `https://github.com/k2-fsa/sherpa-onnx/releases/download/v${VERSION}`

const PLATFORMS = {
  'linux-x64': {
    tarball: `sherpa-onnx-v${VERSION}-linux-x64-shared.tar.bz2`,
    sha256: '58cc7d360fdedf9702954e8b585eb400bbee8668484bf25e4461d5d22ba439d8',
  },
  'osx-arm64': {
    // The macOS shared builds are named after the onnxruntime they bundle;
    // 1.27.1 matches the upstream single-threaded wasm line (#3836).
    tarball: `sherpa-onnx-v${VERSION}-onnxruntime-1.27.1-osx-arm64-shared.tar.bz2`,
    sha256: '5cbb17b6857a1b3d48c9c8e2386d318710eb00f0ccecb01022424fee93bb77b8',
  },
}

function die(msg) {
  console.error(`[fetch-sherpa-onnx] ${msg}`)
  process.exit(1)
}

function detectHost() {
  const { platform, arch } = process
  if (platform === 'darwin' && (arch === 'arm64' || arch === 'x64')) {
    // The osx-arm64 tarball is a universal2 build (ships both slices).
    return 'osx-arm64'
  }
  if (platform === 'linux' && arch === 'x64') return 'linux-x64'
  die(`unsupported host ${platform}/${arch} (supported: linux-x64, osx-arm64)`)
}

async function main() {
  const force = process.argv.includes('--force')
  const host = detectHost()
  const cfg = PLATFORMS[host]
  const sherpaDir = resolve(import.meta.dirname, '..', 'third_party', 'sherpa-onnx')
  const dest = join(sherpaDir, host)
  const marker = join(dest, 'include', 'sherpa-onnx', 'c-api', 'c-api.h')

  if (!force && existsSync(marker)) {
    console.log(`[fetch-sherpa-onnx] ${host} already fetched at ${dest}`)
    return
  }

  const url = `${BASE}/${cfg.tarball}`
  mkdirSync(sherpaDir, { recursive: true })
  console.log(`[fetch-sherpa-onnx] downloading ${url}`)
  const res = await fetch(url)
  if (!res.ok) {
    die(`download failed: HTTP ${res.status} ${res.statusText}`)
  }

  const buf = Buffer.from(await res.arrayBuffer())
  const got = createHash('sha256').update(buf).digest('hex')
  if (cfg.sha256 && got !== cfg.sha256) {
    die(`sha256 mismatch for ${cfg.tarball}:\n  expected ${cfg.sha256}\n  got      ${got}`)
  }
  console.log(`[fetch-sherpa-onnx] sha256 ok (${got})`)

  rmSync(dest, { recursive: true, force: true })
  mkdirSync(dest, { recursive: true })
  const tmp = join(sherpaDir, `.${host}.${VERSION}.tar.bz2`)
  writeFileSync(tmp, buf)
  const tar = spawnSync('tar', ['xjf', tmp, '-C', dest, '--strip-components=1'], {
    stdio: 'inherit',
  })
  rmSync(tmp, { force: true })
  if (tar.status !== 0) {
    die(`extraction failed (tar exit ${tar.status})`)
  }
  console.log(`[fetch-sherpa-onnx] ${host} -> ${dest} (sherpa-onnx ${VERSION})`)
}

main().catch((e) => {
  console.error('[fetch-sherpa-onnx]', e)
  process.exit(1)
})
