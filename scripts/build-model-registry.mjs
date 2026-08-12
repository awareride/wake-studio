#!/usr/bin/env node
/**
 * Generate apps/web/public/model-registry.json from module-owned fragments.
 *
 * Background (issue #77): the registry was hand-maintained, but every model
 * belongs to a module - and ADR-025 says a module owns its own things. Each
 * module now declares its lazily-fetched models in `spec/models.json`
 * (a `{ "models": [ ...RegistryModel ] }` fragment). This script merges
 * every fragment into the single runtime catalog the Model Registry view,
 * the model-source selectors and the Phase 4 export license gate consume
 * (ADR-011 lazy fetch; consumers change nothing).
 *
 * The generated file is committed (reviewable diffs, lockfile-style). Run
 * --check in CI so a stale registry (hand-edit or fragment drift) fails
 * loudly.
 *
 * Usage:
 *   node scripts/build-model-registry.mjs            # print the registry
 *   node scripts/build-model-registry.mjs --update   # write the file
 *   node scripts/build-model-registry.mjs --check    # exit 1 when stale
 *
 * Notes:
 *   - Deterministic: modules are walked in sorted dir order, models keep
 *     fragment order, output is pretty-printed with a trailing newline.
 *   - The wrapper's `updated` field is set to today (UTC, yyyy-mm-dd). The
 *     --check comparison masks it on both sides so an unchanged registry
 *     does not fail daily just because the date rolled over.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { discoverModules } from './lib/module-discovery.mjs'

const repoRoot = resolve(import.meta.dirname, '..')
const REGISTRY_FILE = 'apps/web/public/model-registry.json'

const SCHEMA_REF = './model-registry.schema.json'
const NOTE =
  "Catalog of lazily-fetched models (ADR-011). Weights are never bundled. Each entry's 'license' and 'commercial' fields drive the Phase 4 export license gate."

/** Fields every registry model must declare (mirrors model-registry.schema.json). */
const REQUIRED_FIELDS = ['id', 'name', 'tier', 'source', 'url', 'format', 'license', 'commercial', 'class']

function die(msg) {
  console.error(`[build-model-registry] ${msg}`)
  process.exit(1)
}

/** Read one module's spec/models.json fragment; null when absent. */
function readFragment(moduleDir) {
  const path = resolve(moduleDir, 'spec', 'models.json')
  if (!existsSync(path)) return null
  let frag
  try {
    frag = JSON.parse(readFileSync(path, 'utf8'))
  } catch (err) {
    die(`malformed fragment ${path}: ${err.message}`)
  }
  if (!frag || typeof frag !== 'object' || !Array.isArray(frag.models)) {
    die(`fragment ${path} must be an object with a 'models' array`)
  }
  return frag
}

/** Validate a model entry and normalize it (fills no defaults - strict). */
function validateModel(model, moduleId, path) {
  for (const field of REQUIRED_FIELDS) {
    if (model[field] === undefined || model[field] === null) {
      die(`model '${model.id ?? '<missing id>'}' (${moduleId}) missing required field '${field}' (${path})`)
    }
  }
  if (!Array.isArray(model.tier) || model.tier.length === 0) {
    die(`model '${model.id}' (${moduleId}) 'tier' must be a non-empty array`)
  }
  return model
}

/** Build the registry object from all module fragments (deterministic). */
export function buildRegistry() {
  const modules = discoverModules()
    .map((m) => ({ ...m, frag: readFragment(m.dir) }))
    .filter((m) => m.frag)
    .sort((a, b) => (a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0))

  const models = []
  const seen = new Set()
  for (const { dir, id, frag } of modules) {
    for (const model of frag.models) {
      validateModel(model, id, resolve(dir, 'spec', 'models.json'))
      if (seen.has(model.id)) die(`duplicate model id '${model.id}' (${id})`)
      seen.add(model.id)
      models.push(model)
    }
  }
  if (models.length === 0) die('no model fragments found (expected spec/models.json in at least one module)')

  const today = new Date().toISOString().slice(0, 10)
  return {
    $schema: SCHEMA_REF,
    version: 1,
    updated: today,
    note: NOTE,
    models,
  }
}

function serialize(registry) {
  return `${JSON.stringify(registry, null, 2)}\n`
}

/** Compare against the committed file, ignoring the daily `updated` date. */
function isStale(registry) {
  const committed = readFileSync(resolve(repoRoot, REGISTRY_FILE), 'utf8')
  const mask = (s) => s.replace(/"updated": "\d{4}-\d{2}-\d{2}"/, '"updated": "MASKED"')
  return mask(serialize(registry)) !== mask(committed)
}

function main() {
  const mode = process.argv[2] ?? 'print'
  const registry = buildRegistry()

  if (mode === '--check') {
    if (isStale(registry)) {
      console.error(
        `[build-model-registry] STALE: ${REGISTRY_FILE} does not match the module fragments.\n` +
          `  Run 'pnpm gen:registry' and commit the result.`,
      )
      process.exit(1)
    }
    console.log(`[build-model-registry] OK: ${REGISTRY_FILE} matches module fragments`)
  } else if (mode === '--update') {
    writeFileSync(resolve(repoRoot, REGISTRY_FILE), serialize(registry))
    console.log(`[build-model-registry] wrote ${REGISTRY_FILE} (${registry.models.length} models)`)
  } else {
    process.stdout.write(serialize(registry))
  }
}

main()