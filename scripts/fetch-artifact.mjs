#!/usr/bin/env node
/**
 * Generic artifact fetch (ADR-027 SOP §6.7).
 *
 * Downloads a module's binary assets into its assets/ directory from one of:
 *   - a GitHub Actions run artifact (default; spec build.artifactName), or
 *   - a GitHub Release (spec build.fetch.source = "release", ADR-027 §6.7
 *     for static, non-CI-built models like the openwakeword/hey-buddy onnx),
 *   - a local dir (--from).
 * The module's spec `build` block declares artifactName/registryEntry (or
 * fetch.releaseTag); the fetch is the counterpart of the module's build
 * script.
 *
 * Usage:
 *   node scripts/fetch-artifact.mjs <module-id> [--from <local-dir>]
 *
 * Env:
 *   GITHUB_REPO  owner/name to pull the artifact from (default: git remote)
 *   ARTIFACT_DIR override target dir (default: <module>/assets/)
 *
 * Unpacking honors the module spec's `build.fetch` block (ADR-025):
 *   - build.fetch.subdir  copy into <assets>/<subdir> (default: assets/ root)
 *   - build.fetch.include file whitelist (basenames); only these files are
 *     copied, so demo extras (app.js, index.html, README) are dropped.
 *   - Nested directories in the artifact are flattened: the whitelist is
 *     matched by basename anywhere under the artifact root.
 *   - Release assets may be a .tar.gz that preserves the module's asset
 *     layout; the archive is extracted first, then copied as a tree.
 */

import { existsSync, mkdirSync, copyFileSync, readdirSync, statSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { findModuleById, statSyncSafe } from './lib/module-discovery.mjs'

const repoRoot = resolve(import.meta.dirname, '..')

function die(msg) {
  console.error(`[fetch-artifact] ${msg}`)
  process.exit(1)
}

/** String-entry readdir for the copy helpers (module-discovery uses Dirents). */
function readdirSafe(dir) {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

function defaultRepo() {
  const out = spawnSync('git', ['config', '--get', 'remote.origin.url'], {
    encoding: 'utf8',
  })
  const url = (out.stdout || '').trim()
  const m = url.match(/[:/]([^/]+\/[^/]+?)(?:\.git)?$/)
  return m ? m[1] : 'awareride/wake-studio'
}

function main() {
  const [moduleId, , fromFlag] = process.argv.slice(2)
  const fromIdx = process.argv.indexOf('--from')
  const fromDir = fromIdx >= 0 ? process.argv[fromIdx + 1] : undefined
  if (!moduleId) die('usage: node scripts/fetch-artifact.mjs <module-id> [--from <dir>]')

  const found = findModuleById(moduleId)
  if (!found) die(`no module spec for '${moduleId}'`)
  const { spec, dir } = found
  const build = spec.build
  const fetchCfg = build?.fetch
  const isRelease = fetchCfg?.source === 'release'
  const artifactName = build?.artifactName
  if (!isRelease && !artifactName) {
    die(`module '${moduleId}' has no build.artifactName (and no fetch.source=release)`)
  }

  const targetDir = process.env.ARTIFACT_DIR || resolve(dir, 'assets')
  const destDir = fetchCfg?.subdir ? resolve(targetDir, fetchCfg.subdir) : targetDir
  mkdirSync(destDir, { recursive: true })

  const unpack = (src) => {
    console.log(`[fetch-artifact] unpack -> ${destDir}`)
    if (fetchCfg?.include?.length) {
      copyIncluded(src, destDir, fetchCfg.include)
    } else {
      copyTree(src, destDir)
    }
  }

  if (fromDir && existsSync(fromDir)) {
    console.log(`[fetch-artifact] local: ${fromDir} -> ${destDir}`)
    unpack(fromDir)
    return
  }

  const repo = process.env.GITHUB_REPO || defaultRepo()
  const tmp = join(repoRoot, '.tmp-artifact')
  mkdirSync(tmp, { recursive: true })

  if (isRelease) {
    // Static, non-CI-built models hosted on a GitHub Release (ADR-027 §6.7):
    // e.g. openwakeword/hey-buddy onnx assets. A .tar.gz asset may preserve
    // the module's asset layout; extract before unpacking.
    const tag = fetchCfg.releaseTag
    if (!tag) die(`module '${moduleId}' fetch.source=release needs build.fetch.releaseTag`)
    console.log(`[fetch-artifact] gh release download ${tag} from ${repo}`)
    const out = spawnSync(
      'gh',
      ['release', 'download', tag, '--repo', repo, '--pattern', fetchCfg.pattern ?? '*', '--dir', tmp, '--clobber'],
      { stdio: 'inherit' },
    )
    if (out.status !== 0) die(`gh release download failed (${out.status})`)
    extractArchiveIfNeeded(tmp)
    unpack(tmp)
    rmSync(tmp, { recursive: true, force: true }) // scratch dir; never commit
    console.log(`[fetch-artifact] done -> ${destDir}`)
    return
  }

  console.log(`[fetch-artifact] gh run download ${artifactName} from ${repo}`)
  const out = spawnSync('gh', ['run', 'download', '--repo', repo, '--name', artifactName, '--dir', tmp], {
    stdio: 'inherit',
  })
  if (out.status !== 0) die(`gh run download failed (${out.status})`)
  unpack(tmp)
  rmSync(tmp, { recursive: true, force: true }) // scratch dir; never commit
  console.log(`[fetch-artifact] done -> ${destDir}`)
}

/**
 * If the download contains a single .tar.gz/.tgz (release mode), extract it
 * in place so the copy helpers see the preserved asset layout, then drop the
 * archive itself (never copied into assets/).
 */
function extractArchiveIfNeeded(tmp) {
  for (const entry of readdirSafe(tmp)) {
    if (entry.endsWith('.tar.gz') || entry.endsWith('.tgz')) {
      const archive = resolve(tmp, entry)
      console.log(`[fetch-artifact] extract ${entry}`)
      const out = spawnSync('tar', ['-xzf', archive, '-C', tmp], { stdio: 'inherit' })
      if (out.status !== 0) die(`tar extraction failed (${out.status}): ${archive}`)
      rmSync(archive, { force: true })
      return
    }
  }
}

/** Recursively copy a tree, flattening into dest. */
function copyTree(src, dest) {
  mkdirSync(dest, { recursive: true })
  for (const entry of readdirSafe(src)) {
    const s = resolve(src, entry)
    const d = resolve(dest, entry)
    if (statSyncSafe(s)?.isDirectory()) copyTree(s, d)
    else copyFileSync(s, d)
  }
}

/**
 * Copy only the whitelisted basenames from an artifact, flattening any
 * nested dirs (e.g. install/bin/wasm). Matches by basename anywhere under
 * src; warns on missing files instead of failing (the caller may want a
 * partial copy, mirroring the legacy fetch-sherpa behavior).
 */
function copyIncluded(src, dest, names) {
  mkdirSync(dest, { recursive: true })
  const found = new Set()
  const walk = (dir) => {
    for (const entry of readdirSafe(dir)) {
      const s = resolve(dir, entry)
      if (statSyncSafe(s)?.isDirectory()) {
        walk(s)
      } else if (names.includes(entry) && !found.has(entry)) {
        copyFileSync(s, resolve(dest, entry))
        console.log(`  ok (${statSync(s).size} bytes): ${entry}`)
        found.add(entry)
      }
    }
  }
  walk(src)
  for (const n of names) {
    if (!found.has(n)) console.warn(`[fetch-artifact] warning: ${n} not found in artifact; skipped`)
  }
}

main()
