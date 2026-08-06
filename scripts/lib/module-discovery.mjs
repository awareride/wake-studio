/**
 * Shared module discovery (zero-dependency, Node-only).
 *
 * Walks packages/modules/<category>/<module>/spec/module.spec.json and
 * returns the parsed specs together with their module dirs. Used by the
 * repo-level scripts (build-module, fetch-artifact, gen-module-status) so
 * the walk/read logic lives in ONE place instead of being copy-pasted.
 *
 * Kept dependency-free on purpose: these scripts run under plain `node`
 * and must not import TS packages (module-kit pulls React/Radix).
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

/** Default modules root (relative to the repo root = the script's parent). */
export const DEFAULT_MODULES_ROOT = resolve(import.meta.dirname, '..', '..', 'packages', 'modules')

function readdirSafe(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

/** statSync with a null on failure. */
export function statSyncSafe(p) {
  try {
    return statSync(p)
  } catch {
    return null
  }
}
/**
 * A discovered module. `dir` is the module root
 * (packages/modules/<category>/<module>); `category` is the first path
 * segment below the modules root.
 */

/**
 * Recursively walk the modules root and collect every module spec.
 *
 * Prunes aggressively (mirroring gen-module-status's isDirSafe): only dirs
 * that contain a `spec/` subdir (a module) or look like category dirs are
 * recursed, so build output / node_modules / nested package dirs are never
 * walked.
 */
export function discoverModules(root = DEFAULT_MODULES_ROOT) {
  const out = []
  const walk = (dir, category, depth) => {
    if (depth > 4) return
    const specPath = resolve(dir, 'spec', 'module.spec.json')
    if (existsSync(specPath)) {
      try {
        const spec = JSON.parse(readFileSync(specPath, 'utf8'))
        if (spec && typeof spec === 'object' && spec.meta?.id) {
          out.push({ dir, category, id: spec.meta.id, spec })
        }
      } catch {
        /* malformed spec - skip, keep walking */
      }
    }
    for (const entry of readdirSafe(dir)) {
      if (!entry.isDirectory()) continue
      if (entry.name === 'node_modules') continue
      const sub = resolve(dir, entry.name)
      // Recursable only if it is a module (has spec/) or a category dir
      // (has at least one subdir with a spec/).
      if (recursable(sub)) walk(sub, category || entry.name, depth + 1)
    }
  }
  walk(root, '', 0)
  return out
}

/** Find one module by its spec meta.id. */
export function findModuleById(moduleId, root = DEFAULT_MODULES_ROOT) {
  return discoverModules(root).find((m) => m.id === moduleId)
}

/**
 * True if `dir` is worth recursing into: it is a module (has spec/) or a
 * category dir (has a subdir that has spec/). Excludes build/lock dirs.
 */
function recursable(dir) {
  try {
    const entries = readdirSync(dir, { withFileTypes: true })
    if (entries.some((e) => e.isDirectory() && e.name === 'spec')) return true
    return entries.some(
      (e) =>
        e.isDirectory() &&
        !['node_modules', 'assets', 'tests', 'core', 'web', 'encoders', 'scripts', 'train', 'spec'].includes(e.name) &&
        hasSpecSubdir(resolve(dir, e.name)),
    )
  } catch {
    return false
  }
}

function hasSpecSubdir(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true }).some(
      (e) => e.isDirectory() && e.name === 'spec',
    )
  } catch {
    return false
  }
}

