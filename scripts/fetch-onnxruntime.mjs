#!/usr/bin/env node
/**
 * Fetch the pinned onnxruntime prebuilt C API (issue #192; shared app-class
 * runtime for the openwakeword driver now and kws-streaming #194 later).
 *
 * onnxruntime is a live upstream project (ADR-037 Tier 1-2): we pin a release
 * (ADR-031 style) instead of vendoring source. The official release tarballs
 * ship the C API headers + shared library; this script downloads the platform
 * tarball for the current host, verifies its sha256, and extracts it to
 * third_party/onnxruntime/<host> (gitignored — built by the fetch, never
 * committed; ADR-027 SOP spirit).
 *
 * Usage:
 *   node scripts/fetch-onnxruntime.mjs            # detect host
 *   node scripts/fetch-onnxruntime.mjs --force    # re-fetch even if present
 *
 * Pinned: ONNXRUNTIME_VERSION + per-platform sha256 below. When bumping,
 * update both (sha256sum of the release tarball).
 */
import { createHash } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { spawnSync } from 'node:child_process'

const VERSION = '1.21.0'
const BASE = `https://github.com/microsoft/onnxruntime/releases/download/v${VERSION}`

const PLATFORMS = {
  'linux-x64': {
    tarball: `onnxruntime-linux-x64-${VERSION}.tgz`,
    sha256: '7485c7e7aac6501b27e353dcbe068e45c61ab51fbaf598d13970dfae669d20bf',
  },
  'osx-universal2': {
    tarball: `onnxruntime-osx-universal2-${VERSION}.tgz`,
    sha256: '3c3cfc71e538e592192c14d9bad88ec5d5d8d5d698ebc2c6b3119be8c90b4670',
  },
  'linux-aarch64': {
    tarball: `onnxruntime-linux-aarch64-${VERSION}.tgz`,
    sha256: null, // not verified yet — add when first used
  },
}

function die(msg) {
  console.error(`[fetch-onnxruntime] ${msg}`)
  process.exit(1)
}

function detectHost() {
  const { platform, arch } = process
  if (platform === 'darwin') return 'osx-universal2'
  if (platform === 'linux' && arch === 'x64') return 'linux-x64'
  if (platform === 'linux' && (arch === 'arm64' || arch === 'aarch64')) {
    return 'linux-aarch64'
  }
  die(`unsupported host ${platform}/${arch} (supported: linux-x64, linux-aarch64, osx-universal2)`)
}

function main() {
  const force = process.argv.includes('--force')
  const host = detectHost()
  const cfg = PLATFORMS[host]
  const ortDir = resolve(import.meta.dirname, '..', 'third_party', 'onnxruntime')
  const dest = join(ortDir, host)
  const marker = join(dest, 'include', 'onnxruntime_c_api.h')

  if (!force && existsSync(marker)) {
    console.log(`[fetch-onnxruntime] ${host} already fetched at ${dest}`)
    return
  }

  const url = `${BASE}/${cfg.tarball}`
  const tmpTgz = join(ortDir, `.${host}.${VERSION}.tgz`)
  mkdirSync(ortDir, { recursive: true })

  console.log(`[fetch-onnxruntime] downloading ${url}`)
  const res = await fetch(url)
  if (!res.ok) {
    die(`download failed: HTTP ${res.status} ${res.statusText}`)
  }

  const hash = createHash('sha256')
  await new Promise((resolveStream, rejectStream) => {
    const file = createWriteStream(tmpTgz)
    res.body.on('error', rejectStream)
    file.on('error', rejectStream)
    file.on('finish', resolveStream)
    res.body.pipe(hash).pipe(file)
  })
  const got = hash.digest('hex')

  if (cfg.sha256 && got !== cfg.sha256) {
    rmSync(tmpTgz, { force: true })
    die(`sha256 mismatch for ${cfg.tarball}:\n  expected ${cfg.sha256}\n  got      ${got}`)
  }
  console.log(`[fetch-onnxruntime] sha256 ok (${got})`)

  rmSync(dest, { recursive: true, force: true })
  mkdirSync(dest, { recursive: true })
  const tar = spawnSync('tar', ['xzf', tmpTgz, '-C', dest, '--strip-components=1'], {
    stdio: 'inherit',
  })
  rmSync(tmpTgz, { force: true })
  if (tar.status !== 0) {
    die(`extraction failed (tar exit ${tar.status})`)
  }
  console.log(`[fetch-onnxruntime] ${host} -> ${dest} (onnxruntime ${VERSION})`)
}

main().catch((e) => {
  console.error('[fetch-onnxruntime]', e)
  process.exit(1)
})
