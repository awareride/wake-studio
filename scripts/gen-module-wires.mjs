#!/usr/bin/env node
/**
 * Generate the KWS driver wires (ADR-034).
 *
 * A wire is a composition root: the ONLY file allowed to import impl (driver)
 * modules. There is one wire per bundle context:
 *   - apps/web/src/module-wire.ts                (host bundle)
 *   - packages/modules/kws/engine/web/worker-wire.ts (KWS worker bundle)
 *
 * Both are GENERATED from the module specs (ADR-025: specs are the single
 * fact source). A KWS driver is any module in the kws category whose spec
 * declares `runtime.web.worker` - the engine itself (meta.id `kws-engine`)
 * is the capability module, never a wire target. Adding a driver = adding
 * its spec; the wires regenerate with no host edits.
 *
 * The generated files are committed (reviewable diffs). Run --check in CI /
 * tests so a stale wire fails loudly.
 *
 * Usage:
 *   node scripts/gen-module-wires.mjs            # print both wires
 *   node scripts/gen-module-wires.mjs --update   # write both wire files
 *   node scripts/gen-module-wires.mjs --check    # exit 1 when stale
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { discoverModules } from './lib/module-discovery.mjs'

const repoRoot = resolve(import.meta.dirname, '..')

/** The two wire targets: file path + the bundle context comment. */
const WIRES = [
  {
    file: 'apps/web/src/module-wire.ts',
    header: 'Host composition root (ADR-034) - KWS driver registration.',
  },
  {
    file: 'packages/modules/kws/engine/web/worker-wire.ts',
    header:
      'Worker composition root (ADR-034) - KWS driver registration inside\n * the worker bundle. Imported by web/worker.ts BEFORE any load message.',
  },
]

/** Camel-case a kebab/underscore id into a JS identifier fragment. */
function camelCase(id) {
  return id
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part, i) =>
      i === 0 ? part : part[0].toUpperCase() + part.slice(1),
    )
    .join('')
}

/**
 * Collect the KWS driver modules: kws category, spec declares a web runtime
 * (worker), and not the capability module itself (the engine). Sorted by
 * meta.id for deterministic output.
 */
function kwsDrivers() {
  return discoverModules()
    .filter(
      (m) =>
        m.category === 'kws' &&
        m.id !== 'kws-engine' &&
        m.spec.runtime?.web?.worker === true,
    )
    .sort((a, b) => a.id.localeCompare(b.id))
}

/** Read a module's package name from its package.json (authoritative). */
function packageNameOf({ dir }) {
  const pkgPath = resolve(dir, 'package.json')
  if (!existsSync(pkgPath)) {
    throw new Error(`Cannot generate wires: missing ${pkgPath}`)
  }
  return JSON.parse(readFileSync(pkgPath, 'utf8')).name
}

/** Emit one wire file's source for the given driver modules. */
function renderWire({ header }, drivers) {
  const lines = [
    '/**',
    ' * ' + header,
    ' *',
    ' * GENERATED FILE - do not edit by hand.',
    ' * Regenerate with: node scripts/gen-module-wires.mjs --update',
    ' *',
    ' * Each driver module registers its backend into the KWS engine registry',
    ' * on import (ADR-024/034). Imported as namespaces and referenced via',
    ' * `void` so Vite cannot tree-shake the side-effect imports (a bare',
    ' * side-effect import is only safe when the package declares',
    ' * `sideEffects: true`; the `void` reference is the defensive form).',
    ' */',
  ]
  for (const m of drivers) {
    const ns =
      camelCase(packageNameOf(m).replace(/^@wake-studio\/module-kws-/, '')) +
      'Driver'
    lines.push(`import * as ${ns} from '${packageNameOf(m)}'`)
  }
  for (const m of drivers) {
    const ns =
      camelCase(packageNameOf(m).replace(/^@wake-studio\/module-kws-/, '')) +
      'Driver'
    lines.push(`void ${ns}.${m.spec.runtime.web.engine}`)
  }
  return lines.join('\n') + '\n'
}

/** All driver modules (used by render + check). */
function collect() {
  return kwsDrivers().map((m) => ({ ...m, packageName: packageNameOf(m) }))
}

function main() {
  const args = process.argv.slice(2)
  const mode = args.includes('--update')
    ? 'update'
    : args.includes('--check')
      ? 'check'
      : 'print'
  const drivers = collect()
  const stale = []

  for (const wire of WIRES) {
    const target = resolve(repoRoot, wire.file)
    const generated = renderWire(wire, drivers)
    if (mode === 'update') {
      writeFileSync(target, generated)
      console.log(`updated ${wire.file}`)
    } else if (mode === 'check') {
      if (!existsSync(target) || readFileSync(target, 'utf8') !== generated) {
        stale.push(wire.file)
      }
    } else {
      console.log(`--- ${wire.file} ---`)
      console.log(generated)
    }
  }

  if (mode === 'check') {
    if (stale.length > 0) {
      console.error(
        `Stale KWS wires (${stale.join(', ')}). ` +
          'Run: node scripts/gen-module-wires.mjs --update',
      )
      process.exit(1)
    }
    console.log(`wires up to date (${drivers.length} driver(s))`)
  }
}

main()
