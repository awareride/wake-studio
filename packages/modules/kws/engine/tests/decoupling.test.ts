/**
 * kws-engine - ADR-024/034 decoupling guard (issue #23 regression).
 *
 * ADR-024: "adding a KWS type requires no modification to shared underlying
 * modules" — the engine core must never import a driver module. ADR-034: the
 * worker composition root (web/worker-wire.ts, generated from specs) is the
 * ONLY file in the engine web target that imports driver modules.
 *
 * This test statically scans the engine's core + web source files and fails
 * if any of them imports a driver package (except the wire), and asserts the
 * generated wire is present and up to date. It runs from the engine module's
 * own filesystem, so it also catches a driver import sneaking into core via
 * a relative path.
 */

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { execFileSync } from 'node:child_process'

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

describe('ADR-024/034: engine core + web never import driver modules', () => {
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

  // ADR-034: the worker composition root (web/worker-wire.ts) is the ONLY
  // file in the engine web target that may import driver modules. It is
  // generated from the module specs (scripts/gen-module-wires.mjs).
  const webDir = resolve(__dirname, '../web')
  const webFiles = listFiles(webDir).filter((f) => !f.endsWith('worker-wire.ts'))

  it.each(webFiles)('no driver import in web target %s', (file) => {
    const src = readFileSync(file, 'utf8')
    for (const pkg of driverPackageNames) {
      expect(src).not.toContain(`'${pkg}'`)
      expect(src).not.toContain(`"${pkg}"`)
    }
  })

  it('the worker wire imports every registered driver (ADR-034)', () => {
    // web/worker-wire.ts (generated) must import every driver package so the
    // worker bundle gets the registration side-effects (issue #23).
    const wire = readFileSync(
      resolve(__dirname, '../web/worker-wire.ts'),
      'utf8',
    )
    for (const pkg of driverPackageNames) {
      expect(wire).toContain(`'${pkg}'`)
    }
  })

  it('the generated worker wire is up to date (ADR-034)', () => {
    // Staleness guard: regenerate in-memory and compare. Mirrors
    // `node scripts/gen-module-wires.mjs --check`.
    const repoRoot = resolve(__dirname, '../../../../..')
    const check = execFileSync(
      'node',
      ['scripts/gen-module-wires.mjs', '--check'],
      { cwd: repoRoot, encoding: 'utf8' },
    )
    expect(check).toContain('wires up to date')
  })
})
