#!/usr/bin/env node
/**
 * Generate apps/web/public/dataset-engines.json from the dataset module's TTS
 * engine descriptors (ADR-044 §5.1, task #205).
 *
 * Each engine is a small JSON descriptor in
 * packages/modules/data/dataset/spec/engines/<id>.json (kind, runtime, params,
 * provenanceTemplate). The generated catalog is the runtime fact source the
 * Datasets generation wizard (#208) renders - adding a vendor = adding a
 * descriptor + a backend adapter, no host-module edits.
 *
 * The generated file is committed (reviewable diffs, lockfile-style). Run
 * --check in CI so a stale catalog (hand-edit or descriptor drift) fails
 * loudly.
 *
 * Usage:
 *   node scripts/build-dataset-engines.mjs            # print the catalog
 *   node scripts/build-dataset-engines.mjs --update   # write the file
 *   node scripts/build-dataset-engines.mjs --check    # exit 1 when stale
 *
 * Deterministic: engines are walked in sorted filename order, output is
 * pretty-printed with a trailing newline.
 */

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(import.meta.dirname, '..')
const ENGINES_DIR = 'packages/modules/data/dataset/spec/engines'
const CATALOG_FILE = 'apps/web/public/dataset-engines.json'

const VALID_KINDS = ['classic-tts', 'online-http-tts', 'llm-tts']
const VALID_RUNTIMES = ['browser', 'backend']
const NOTE =
  "Catalog of TTS engine descriptors (ADR-044 §5, #205). Generated from packages/modules/data/dataset/spec/engines/*.json - the descriptors are the single fact source. The Datasets generation wizard renders each engine's params from here."

function readEngines() {
  const dir = resolve(repoRoot, ENGINES_DIR)
  const engines = []
  if (!existsSync(dir)) return engines
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.json')) continue
    const engine = JSON.parse(readFileSync(resolve(dir, name), 'utf8'))
    engine._file = name
    engines.push(engine)
  }
  return engines
}

function validate(engines) {
  const errors = []
  const seen = new Set()
  for (const e of engines) {
    if (!e.id) errors.push(`${e._file}: engine without id`)
    else if (seen.has(e.id)) errors.push(`duplicate engine id: ${e.id}`)
    seen.add(e.id)
    if (!VALID_KINDS.includes(e.kind)) errors.push(`${e.id}: invalid kind ${e.kind}`)
    if (!Array.isArray(e.runtime) || e.runtime.length === 0)
      errors.push(`${e.id}: runtime must be a non-empty array`)
    else if (!e.runtime.every((r) => VALID_RUNTIMES.includes(r)))
      errors.push(`${e.id}: runtime must be browser|backend`)
    if (!e.params || typeof e.params !== 'object') errors.push(`${e.id}: params must be an object`)
    if (!e.provenanceTemplate || typeof e.provenanceTemplate !== 'object')
      errors.push(`${e.id}: provenanceTemplate must be an object`)
  }
  return errors
}

function serialize(engines) {
  const payload = { note: NOTE, engines: engines.map((e) => strip(e)) }
  return JSON.stringify(payload, null, 2) + '\n'
}

function strip(e) {
  const { _file, ...rest } = e
  void _file
  return rest
}

function isStaleFile(file, content) {
  if (!existsSync(resolve(repoRoot, file))) return true
  return readFileSync(resolve(repoRoot, file), 'utf8') !== content
}

function main() {
  const mode = process.argv[2] ?? ''
  const engines = readEngines()
  const errors = validate(engines)

  if (mode === '--check') {
    let ok = true
    for (const e of errors) {
      console.error(`[build-dataset-engines] INVALID: ${e}`)
      ok = false
    }
    if (isStaleFile(CATALOG_FILE, serialize(engines))) {
      console.error(
        `[build-dataset-engines] STALE: ${CATALOG_FILE} does not match the engine descriptors.\n` +
          `  Run 'node scripts/build-dataset-engines.mjs --update' and commit the result.`,
      )
      ok = false
    }
    if (ok) {
      console.log(
        `[build-dataset-engines] OK: ${CATALOG_FILE} matches the ${engines.length} engine descriptors`,
      )
    } else {
      process.exit(1)
    }
  } else if (mode === '--update') {
    for (const e of errors) console.error(`[build-dataset-engines] INVALID: ${e}`)
    if (errors.length > 0) process.exit(1)
    writeFileSync(resolve(repoRoot, CATALOG_FILE), serialize(engines))
    console.log(
      `[build-dataset-engines] wrote ${CATALOG_FILE} (${engines.length} engines)`,
    )
  } else {
    for (const e of errors) console.error(`[build-dataset-engines] INVALID: ${e}`)
    if (errors.length > 0) process.exit(1)
    process.stdout.write(serialize(engines))
  }
}

main()
