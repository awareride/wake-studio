/**
 * studio-backend - module registry (ADR-025).
 *
 * Discovers every module in the monorepo (packages/modules/.../spec/
 * module.spec.json), validates its spec with module-kit, and exposes the
 * catalog for route mounting + train/artifact operations.
 *
 * The registry is the single source of truth for "what modules exist" in the
 * backend world - mirroring how the web panel registry consumes the same specs.
 *
 * Note: the walk here is intentionally a 2-level scan (category/module). The
 * shared scripts/lib/module-discovery.mjs handles the recursive discovery for
 * the repo-level build scripts; the studio-backend registry instead validates
 * specs (module-kit) and probes the filesystem for runtime targets, which the
 * build scripts do not need.
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ModuleSpec } from '@wake-studio/contracts'
import { validateModuleSpec } from '@wake-studio/module-kit/validator'

const modulesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../packages/modules')

export interface RegisteredModule {
  /** Package directory (packages/modules/<category>/<module>). */
  dir: string
  /** Category directory name (afe, kws, ...). */
  category: string
  /** Module id (spec.meta.id). */
  id: string
  spec: ModuleSpec
  /** Node target present? (node/index.ts) */
  hasNodeTarget: boolean
  /** Train target present? (train/) */
  hasTrainTarget: boolean
  /** Device target present? (device/) */
  hasDeviceTarget: boolean
}

/** Scan the modules tree for specs. Returns modules sorted by category+id. */
export function discoverModules(root: string = modulesRoot): RegisteredModule[] {
  const out: RegisteredModule[] = []
  for (const category of safeReaddir(root)) {
    const catDir = join(root, category)
    for (const mod of safeReaddir(catDir)) {
      const dir = join(catDir, mod)
      const specPath = join(dir, 'spec', 'module.spec.json')
      if (!existsSync(specPath)) continue
      try {
        const raw = JSON.parse(readFileSync(specPath, 'utf8'))
        const validation = validateModuleSpec(raw)
        if (!validation.ok) {
          // Fail loud: a malformed spec should surface at startup, not at use.
          console.error(
            `[module-registry] invalid spec ${category}/${mod}: ${validation.errors.join('; ')}`,
          )
          continue
        }
        const spec = raw as ModuleSpec
        out.push({
          dir,
          category,
          id: spec.meta.id,
          spec,
          hasNodeTarget: hasFile(dir, 'node', 'index.ts') || hasFile(dir, 'node', 'index.js'),
          hasTrainTarget: existsSync(join(dir, 'train')),
          hasDeviceTarget: existsSync(join(dir, 'device')),
        })
      } catch (err) {
        console.error(`[module-registry] failed to read spec ${category}/${mod}:`, err)
      }
    }
  }
  return out.sort((a, b) => a.category.localeCompare(b.category) || a.id.localeCompare(b.id))
}

/** Find one module by id. */
export function findModule(id: string, root?: string): RegisteredModule | undefined {
  return discoverModules(root).find((m) => m.id === id)
}

/** True if `<dir>/<...parts>` is a regular file. */
function hasFile(dir: string, ...parts: string[]): boolean {
  try {
    return existsSync(join(dir, ...parts))
  } catch {
    return false
  }
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}
