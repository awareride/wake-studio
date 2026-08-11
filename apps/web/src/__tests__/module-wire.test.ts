/**
 * apps/web - ADR-034 composition-root guard.
 *
 * The host wire (src/module-wire.ts, generated from the module specs by
 * scripts/gen-module-wires.mjs) is the ONLY file in apps/web allowed to
 * import driver (impl) modules. This test scans the app source and fails if
 * any other file imports a KWS driver package, and asserts the wire is
 * present + up to date.
 */

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { execFileSync } from 'node:child_process'

const srcDir = resolve(__dirname, '..')
const driverPackageNames = [
  '@wake-studio/module-kws-openwakeword',
  '@wake-studio/module-kws-plix',
  '@wake-studio/module-kws-sherpa',
  '@wake-studio/module-kws-streaming',
]

/** Recursively list .ts/.tsx files under a directory. */
function listFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules') continue
      out.push(...listFiles(full))
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full)
    }
  }
  return out
}

describe('ADR-034: only module-wire.ts imports driver modules in apps/web', () => {
  const files = listFiles(srcDir).filter(
    (f) =>
      !f.endsWith('module-wire.ts') && !f.endsWith('module-wire.test.ts'),
  )

  it('scans the app source directory', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it.each(files)('no driver import in %s', (file) => {
    const src = readFileSync(file, 'utf8')
    for (const pkg of driverPackageNames) {
      expect(src).not.toContain(`'${pkg}'`)
      expect(src).not.toContain(`"${pkg}"`)
    }
  })

  it('the host wire exists and imports every driver', () => {
    const wirePath = resolve(srcDir, 'module-wire.ts')
    expect(existsSync(wirePath)).toBe(true)
    const wire = readFileSync(wirePath, 'utf8')
    for (const pkg of driverPackageNames) {
      expect(wire).toContain(`'${pkg}'`)
    }
  })

  it('the host wire is up to date (ADR-034)', () => {
    const repoRoot = resolve(srcDir, '../../..')
    const check = execFileSync(
      'node',
      ['scripts/gen-module-wires.mjs', '--check'],
      { cwd: repoRoot, encoding: 'utf8' },
    )
    expect(check).toContain('wires up to date')
  })
})
