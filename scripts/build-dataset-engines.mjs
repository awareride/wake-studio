#!/usr/bin/env node
/**
 * Generate apps/web/public/dataset-engines.json from TTS engine MODULES.
 *
 * Engines are `data`-category modules that declare `spec.tts` (ADR-044 §5,
 * #205) — exactly how `spec.train` marks a trainable module. Each engine
 * module (`packages/modules/data/<engine>/`) owns its `spec.params` (renders
 * its generation panel) + `spec.tts` (kind / runtime / provenanceTemplate) +
 * `adapter.py` (the backend adapter). This script discovers those modules and
 * emits the runtime catalog the Datasets generation wizard consumes.
 *
 * The generated file is committed (reviewable diffs, lockfile-style). Run
 * --check in CI so a stale catalog (hand-edit or spec drift) fails loudly.
 *
 * Usage:
 *   node scripts/build-dataset-engines.mjs            # print the catalog
 *   node scripts/build-dataset-engines.mjs --update   # write the file
 *   node scripts/build-dataset-engines.mjs --check    # exit 1 when stale
 *
 * Deterministic: engines are walked in sorted dir order, output is
 * pretty-printed with a trailing newline.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { discoverModules } from './lib/module-discovery.mjs'

const repoRoot = resolve(import.meta.dirname, '..')
const CATALOG_FILE = 'apps/web/public/dataset-engines.json'

const VALID_KINDS = ['classic-tts', 'online-http-tts', 'llm-tts']
const VALID_RUNTIMES = ['browser', 'backend']
const NOTE =
  "Catalog of TTS engine modules (ADR-044 §5, #205). Generated from data-category modules declaring spec.tts - the module specs are the single fact source (ADR-025). The Datasets generation wizard renders each engine's params (spec.params) and provenance from here."

/** Engine modules: data-category modules declaring spec.tts. */
export function buildEngineCatalog() {
  const modules = discoverModules()
    .filter((m) => m.spec.tts)
    .sort((a, b) => (a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0))

  return {
    note: NOTE,
    engines: modules.map(({ id, category, spec }) => ({
      id,
      category,
      name: spec.meta?.name ?? id,
      kind: spec.tts.kind,
      runtime: spec.tts.runtime,
      params: spec.params ?? [],
      defaultModel: spec.tts.defaultModel,
      provenanceTemplate: spec.tts.provenanceTemplate,
    })),
  }
}

function validate(catalog) {
  const errors = []
  const seen = new Set()
  for (const e of catalog.engines) {
    if (!e.id) errors.push('engine without id')
    else if (seen.has(e.id)) errors.push(`duplicate engine id: ${e.id}`)
    seen.add(e.id)
    if (!VALID_KINDS.includes(e.kind)) errors.push(`${e.id}: invalid kind ${e.kind}`)
    if (!Array.isArray(e.runtime) || e.runtime.length === 0)
      errors.push(`${e.id}: runtime must be a non-empty array`)
    else if (!e.runtime.every((r) => VALID_RUNTIMES.includes(r)))
      errors.push(`${e.id}: runtime must be browser|backend`)
    if (!Array.isArray(e.params)) errors.push(`${e.id}: params must be an array`)
    if (!e.provenanceTemplate || typeof e.provenanceTemplate !== 'object')
      errors.push(`${e.id}: provenanceTemplate must be an object`)
  }
  return errors
}

function serialize(catalog) {
  return JSON.stringify(catalog, null, 2) + '\n'
}

function isStaleFile(file, content) {
  if (!existsSync(resolve(repoRoot, file))) return true
  return readFileSync(resolve(repoRoot, file), 'utf8') !== content
}

function main() {
  const mode = process.argv[2] ?? ''
  const catalog = buildEngineCatalog()
  const errors = validate(catalog)

  if (mode === '--check') {
    let ok = true
    for (const e of errors) {
      console.error(`[build-dataset-engines] INVALID: ${e}`)
      ok = false
    }
    if (isStaleFile(CATALOG_FILE, serialize(catalog))) {
      console.error(
        `[build-dataset-engines] STALE: ${CATALOG_FILE} does not match the engine module specs.\n` +
          `  Run 'node scripts/build-dataset-engines.mjs --update' and commit the result.`,
      )
      ok = false
    }
    if (ok) {
      console.log(
        `[build-dataset-engines] OK: ${CATALOG_FILE} matches the ${catalog.engines.length} engine modules`,
      )
    } else {
      process.exit(1)
    }
  } else if (mode === '--update') {
    for (const e of errors) console.error(`[build-dataset-engines] INVALID: ${e}`)
    if (errors.length > 0) process.exit(1)
    writeFileSync(resolve(repoRoot, CATALOG_FILE), serialize(catalog))
    console.log(
      `[build-dataset-engines] wrote ${CATALOG_FILE} (${catalog.engines.length} engines)`,
    )
  } else {
    for (const e of errors) console.error(`[build-dataset-engines] INVALID: ${e}`)
    if (errors.length > 0) process.exit(1)
    process.stdout.write(serialize(catalog))
  }
}

main()
