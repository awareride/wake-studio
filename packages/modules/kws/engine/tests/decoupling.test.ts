/**
 * kws-engine - ADR-024 decoupling guard (issue #23 regression).
 *
 * ADR-024: "adding a KWS type requires no modification to shared underlying
 * modules" — the engine core must never import a driver module. The worker
 * assembly seam (web/worker-assembly.ts) is the ONE place that wires drivers
 * into the worker bundle; it lives in the web target, not core.
 *
 * This test statically scans the engine's core source files and fails if any
 * of them imports a driver package. It runs from the engine module's own
 * filesystem, so it also catches a driver import sneaking into core via a
 * relative path.
 */

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'

const coreDir = resolve(__dirname, '../core')
const driverPackageNames = [
  '@wake-studio/module-kws-openwakeword',
  '@wake-studio/module-kws-plix',
  '@wake-studio/module-kws-sherpa',
  '@wake-studio/module-kws-streaming',
]

/** Recursively list files under a directory. */
function listFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      out.push(...listFiles(full))
    } else if (/\.(ts|tsx|mjs|js)$/.test(entry)) {
      out.push(full)
    }
  }
  return out
}

describe('ADR-024: engine core does not import driver modules', () => {
  const files = listFiles(coreDir)

  it('scans the engine core directory', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it.each(files)('no driver import in %s', (file) => {
    const src = readFileSync(file, 'utf8')
    for (const pkg of driverPackageNames) {
      expect(src).not.toContain(`'${pkg}'`)
      expect(src).not.toContain(`"${pkg}"`)
    }
    // Relative imports that walk up past core/ into a driver dir would also
    // violate the decoupling rule.
    expect(src).not.toMatch(
      /from\s+['"].*module-kws-(openwakeword|plix|sherpa|streaming)['"]/,
    )
  })

  it('the worker assembly seam is the only driver wiring point', () => {
    // web/worker-assembly.ts must exist and import every registered driver so
    // the worker bundle gets the registration side-effects (issue #23).
    const assembly = readFileSync(
      resolve(__dirname, '../web/worker-assembly.ts'),
      'utf8',
    )
    for (const pkg of driverPackageNames) {
      expect(assembly).toContain(`'${pkg}'`)
    }
  })
})
