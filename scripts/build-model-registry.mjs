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

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { discoverModules } from './lib/module-discovery.mjs'

const repoRoot = resolve(import.meta.dirname, '..')
const REGISTRY_FILE = 'apps/web/public/model-registry.json'

const SCHEMA_REF = './model-registry.schema.json'
const NOTE =
  "Catalog of lazily-fetched models (ADR-011). Weights are never bundled. Each entry's 'license' and 'commercial' fields drive the Phase 4 export license gate."

/** Trainable-modules catalog (issue #105): modules declaring spec.train. */
const TRAIN_MODULES_FILE = 'apps/web/public/train-modules.json'
const TRAIN_MODULES_NOTE =
  'Catalog of trainable modules (spec.train, issue #105). Generated from the module specs - the single shared fact source (ADR-025). The training console picks the model type (openwakeword / streaming / rnnoise), renders its train config, and offers the invocation methods the module declares.'

/**
 * Module-owned train files (notebookLocal / entry) copied into the app's
 * public dir so the PWA serves them from its own origin - no GitHub fetch
 * (issue #105, human feedback: users do not use the WakeStudio repo).
 */
const TRAIN_ASSETS_DIR = 'apps/web/public/train'

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

/** Build the trainable-modules catalog (deterministic, spec-driven). */
export function buildTrainModules() {
  const modules = discoverModules()
    .map((m) => ({ ...m, train: m.spec.train }))
    .filter((m) => m.train)
    .sort((a, b) => (a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0))

  const today = new Date().toISOString().slice(0, 10)
  return {
    $schema: './train-modules.schema.json',
    version: 1,
    updated: today,
    note: TRAIN_MODULES_NOTE,
    modules: modules.map(({ id, category, spec, train }) => ({
      id,
      category,
      name: spec.meta?.name ?? id,
      license: spec.meta?.license ?? '',
      maturity: spec.meta?.maturity ?? '',
      train,
    })),
  }
}

function isStaleFile(path, serialized, maskUpdated = true) {
  const committed = readFileSync(resolve(repoRoot, path), 'utf8')
  const mask = (s) => s.replace(/"updated": "\d{4}-\d{2}-\d{2}"/, '"updated": "MASKED"')
  const a = maskUpdated ? mask(serialized) : serialized
  const b = maskUpdated ? mask(committed) : committed
  return a !== b
}

/** Serialize the trainable-modules catalog. */
function serializeTrainModules(catalog) {
  return `${JSON.stringify(catalog, null, 2)}\n`
}

/** The module-owned train files to copy into the app's public dir. */
function trainAssets(module) {
  const out = []
  const t = module.spec?.train
  // notebookLocal is repo-relative (ADR-035); entry is module-relative
  // ("train/train.py" lives under the module dir, docs/modules/training.md §4.1).
  if (t?.notebookLocal) {
    const base = t.notebookLocal.split('/').pop()
    out.push({
      src: resolve(repoRoot, t.notebookLocal),
      target: resolve(repoRoot, TRAIN_ASSETS_DIR, module.id, base),
      relTarget: `${TRAIN_ASSETS_DIR}/${module.id}/${base}`,
      declared: t.notebookLocal,
    })
  }
  if (t?.entry) {
    const base = t.entry.split('/').pop()
    out.push({
      src: resolve(module.dir, t.entry),
      target: resolve(repoRoot, TRAIN_ASSETS_DIR, module.id, base),
      relTarget: `${TRAIN_ASSETS_DIR}/${module.id}/${base}`,
      declared: `${module.id}:${t.entry}`,
    })
  }
  return out
}

/** Copy module-owned train files into public/train/<module-id>/ (--update). */
export function syncTrainAssets() {
  const modules = discoverModules().filter((m) => m.spec?.train)
  const copied = []
  for (const module of modules) {
    for (const { src, target, relTarget, declared } of trainAssets(module)) {
      if (!existsSync(src)) {
        die(`train file declared in spec.train but missing: ${declared}`)
      }
      mkdirSync(dirname(target), { recursive: true })
      copyFileSync(src, target)
      copied.push(relTarget)
    }
  }
  return copied
}

/** Verify the copied train assets match the module files (--check). */
export function checkTrainAssets() {
  const modules = discoverModules().filter((m) => m.spec?.train)
  let ok = true
  for (const module of modules) {
    for (const { src, relTarget, declared } of trainAssets(module)) {
      if (!existsSync(src)) {
        die(`train file declared in spec.train but missing: ${declared}`)
      }
      const dst = resolve(repoRoot, relTarget)
      if (!existsSync(dst) || readFileSync(src, 'utf8') !== readFileSync(dst, 'utf8')) {
        console.error(
          `[build-model-registry] STALE train asset: ${relTarget} does not match ${declared}.\n` +
            `  Run 'pnpm gen:registry' and commit the result.`,
        )
        ok = false
      }
    }
  }
  return ok
}

function main() {
  const mode = process.argv[2] ?? 'print'
  const registry = buildRegistry()
  const trainModules = buildTrainModules()

  if (mode === '--check') {
    let ok = true
    if (isStaleFile(REGISTRY_FILE, serialize(registry))) {
      console.error(
        `[build-model-registry] STALE: ${REGISTRY_FILE} does not match the module fragments.\n` +
          `  Run 'pnpm gen:registry' and commit the result.`,
      )
      ok = false
    }
    if (isStaleFile(TRAIN_MODULES_FILE, serializeTrainModules(trainModules))) {
      console.error(
        `[build-model-registry] STALE: ${TRAIN_MODULES_FILE} does not match the module specs.\n` +
          `  Run 'pnpm gen:registry' and commit the result.`,
      )
      ok = false
    }
    if (!checkTrainAssets()) ok = false
    if (ok) {
      console.log(
        `[build-model-registry] OK: ${REGISTRY_FILE} + ${TRAIN_MODULES_FILE} + public/train/ match the module fragments/specs`,
      )
    } else {
      process.exit(1)
    }
  } else if (mode === '--update') {
    writeFileSync(resolve(repoRoot, REGISTRY_FILE), serialize(registry))
    console.log(`[build-model-registry] wrote ${REGISTRY_FILE} (${registry.models.length} models)`)
    writeFileSync(resolve(repoRoot, TRAIN_MODULES_FILE), serializeTrainModules(trainModules))
    console.log(
      `[build-model-registry] wrote ${TRAIN_MODULES_FILE} (${trainModules.modules.length} trainable modules)`,
    )
    const copied = syncTrainAssets()
    for (const rel of copied) console.log(`[build-model-registry] copied train asset -> ${rel}`)
  } else {
    process.stdout.write(serialize(registry))
    process.stdout.write('\n')
    process.stdout.write(serializeTrainModules(trainModules))
  }
}

main()