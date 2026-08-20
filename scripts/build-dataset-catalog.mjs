#!/usr/bin/env node
/**
 * Generate apps/web/public/datasets.json from the curated built-in catalog.
 *
 * Built-ins (ADR-044 §7, #207) are immutable references (`kind: builtin`):
 * the curated source of truth lives at
 * `packages/modules/data/dataset/catalog/builtins.json` (a `DatasetBuiltinCatalog`),
 * and this script emits the runtime catalog the Datasets console + the
 * Training wizard's `datasets[]` picker consume. The generated file is
 * committed (reviewable diffs, lockfile-style); --check fails CI when stale
 * (mirrors build-model-registry.mjs / build-dataset-engines.mjs).
 *
 * Usage:
 *   node scripts/build-dataset-catalog.mjs            # print the catalog
 *   node scripts/build-dataset-catalog.mjs --update   # write the file
 *   node scripts/build-dataset-catalog.mjs --check    # exit 1 when stale
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(import.meta.dirname, '..')
const SOURCE = 'packages/modules/data/dataset/catalog/builtins.json'
const CATALOG_FILE = 'apps/web/public/datasets.json'

const MATERIALIZE_TYPES = ['canonical-zip', 'speech-commands-v2', 'pending-host']

function readSource() {
  return JSON.parse(readFileSync(resolve(repoRoot, SOURCE), 'utf8'))
}

function validate(catalog) {
  const errors = []
  if (catalog.schemaVersion !== 1) {
    errors.push(`schemaVersion must be 1 (got ${String(catalog.schemaVersion)})`)
  }
  if (!Array.isArray(catalog.datasets) || catalog.datasets.length === 0) {
    return ['datasets must be a non-empty array']
  }
  const seen = new Set()
  for (const entry of catalog.datasets) {
    const id = entry.id ?? '(no id)'
    if (seen.has(id)) errors.push(`duplicate dataset id: ${id}`)
    seen.add(id)
    if (entry.kind !== 'builtin') errors.push(`${id}: kind must be "builtin"`)
    if (!entry.materialize || typeof entry.materialize !== 'object') {
      errors.push(`${id}: materialize descriptor is required`)
    } else if (!MATERIALIZE_TYPES.includes(entry.materialize.type)) {
      errors.push(`${id}: materialize.type must be one of ${MATERIALIZE_TYPES.join(', ')}`)
    } else if (
      entry.materialize.type === 'canonical-zip' &&
      !(typeof entry.materialize.url === 'string' && entry.materialize.url.length > 0)
    ) {
      errors.push(`${id}: canonical-zip materialize requires a non-empty url`)
    }
    if (!Array.isArray(entry.provenance) || entry.provenance.length === 0) {
      errors.push(`${id}: provenance must be non-empty`)
    }
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
  const catalog = readSource()
  const errors = validate(catalog)

  if (mode === '--check') {
    let ok = true
    for (const e of errors) {
      console.error(`[build-dataset-catalog] INVALID: ${e}`)
      ok = false
    }
    if (isStaleFile(CATALOG_FILE, serialize(catalog))) {
      console.error(
        `[build-dataset-catalog] STALE: ${CATALOG_FILE} does not match ${SOURCE}.\n` +
          `  Run 'node scripts/build-dataset-catalog.mjs --update' and commit the result.`,
      )
      ok = false
    }
    if (ok) {
      console.log(
        `[build-dataset-catalog] OK: ${CATALOG_FILE} matches the ${catalog.datasets.length} built-in datasets`,
      )
    } else {
      process.exit(1)
    }
  } else if (mode === '--update') {
    for (const e of errors) console.error(`[build-dataset-catalog] INVALID: ${e}`)
    if (errors.length > 0) process.exit(1)
    writeFileSync(resolve(repoRoot, CATALOG_FILE), serialize(catalog))
    console.log(
      `[build-dataset-catalog] wrote ${CATALOG_FILE} (${catalog.datasets.length} built-in datasets)`,
    )
  } else {
    for (const e of errors) console.error(`[build-dataset-catalog] INVALID: ${e}`)
    if (errors.length > 0) process.exit(1)
    process.stdout.write(serialize(catalog))
  }
}

main()
