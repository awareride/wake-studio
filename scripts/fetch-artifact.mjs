#!/usr/bin/env node
/**
 * Generic artifact fetch (ADR-027 SOP §6.7).
 *
 * Downloads a built artifact (from a GitHub Actions run, or a local dir) into
 * the owning module's assets/ directory. The module's spec `build` block
 * declares artifactName + registryEntry; the fetch is the counterpart of the
 * module's build script.
 *
 * Usage:
 *   node scripts/fetch-artifact.mjs <module-id> [--from <local-dir>]
 *
 * Env:
 *   GITHUB_REPO  owner/name to pull the artifact from (default: git remote)
 *   ARTIFACT_DIR override target dir (default: <module>/assets/)
 *
 * The artifact name comes from the module spec (build.artifactName).
 */

import { existsSync, mkdirSync, copyFileSync, readdirSync, statSync, readFileSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')

function die(msg) {
  console.error(`[fetch-artifact] ${msg}`)
  process.exit(1)
}

function findModule(moduleId) {
  const root = resolve(repoRoot, 'packages/modules')
  const walk = (dir, depth) => {
    if (depth > 4) return null
    const specPath = resolve(dir, 'spec', 'module.spec.json')
    if (existsSync(specPath)) {
      try {
        const spec = JSON.parse(readFileSync(specPath, 'utf8'))
        if (spec.meta?.id === moduleId) return { spec, dir }
      } catch {
        /* keep walking */
      }
    }
    for (const entry of readdirSafe(dir)) {
      const sub = resolve(dir, entry)
      if (existsSync(sub) && statSyncSafe(sub)?.isDirectory()) {
        const found = walk(sub, depth + 1)
        if (found) return found
      }
    }
    return null
  }
  return walk(root, 0)
}

function readdirSafe(dir) {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}
function statSyncSafe(p) {
  try {
    return statSync(p)
  } catch {
    return null
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

  const found = findModule(moduleId)
  if (!found) die(`no module spec for '${moduleId}'`)
  const { spec, dir } = found
  const build = spec.build
  const artifactName = build?.artifactName
  if (!artifactName) die(`module '${moduleId}' has no build.artifactName`)

  const targetDir = process.env.ARTIFACT_DIR || resolve(dir, 'assets')
  mkdirSync(targetDir, { recursive: true })

  if (fromDir && existsSync(fromDir)) {
    console.log(`[fetch-artifact] local: ${fromDir} -> ${targetDir}`)
    copyTree(fromDir, targetDir)
    return
  }

  const repo = process.env.GITHUB_REPO || defaultRepo()
  console.log(`[fetch-artifact] gh run download ${artifactName} from ${repo}`)
  const tmp = join(repoRoot, '.tmp-artifact')
  mkdirSync(tmp, { recursive: true })
  const out = spawnSync('gh', ['run', 'download', '--repo', repo, '--name', artifactName, '--dir', tmp], {
    stdio: 'inherit',
  })
  if (out.status !== 0) die(`gh run download failed (${out.status})`)
  copyTree(tmp, targetDir)
  console.log(`[fetch-artifact] done -> ${targetDir}`)
}

function copyTree(src, dest) {
  mkdirSync(dest, { recursive: true })
  for (const entry of readdirSafe(src)) {
    const s = resolve(src, entry)
    const d = resolve(dest, entry)
    if (statSyncSafe(s)?.isDirectory()) copyTree(s, d)
    else copyFileSync(s, d)
  }
}

main()
