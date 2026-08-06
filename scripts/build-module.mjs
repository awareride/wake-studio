#!/usr/bin/env node
/**
 * Generic build-module driver for the shared build workflow (ADR-027 §6.7).
 *
 * Given a module id, reads the module's `spec/module.spec.json` `build` block
 * and runs its `script` (module-owned build logic) with the workflow inputs
 * passed as environment variables. The workflow itself never pre-knows a
 * module's parameters - the spec is the fact source.
 *
 * Usage:
 *   node scripts/build-module.mjs <module-id>
 *
 * Env:
 *   MODULE_DIR   absolute path to the module root (default: derived from
 *                packages/modules/<category>/<id>/)
 *   INPUT_<ID>   each build input, uppercased + dash->underscore, e.g.
 *                INPUT_SHERPA_VERSION, INPUT_KWS_MODEL (from
 *                github.event.inputs in the workflow)
 *   ARTIFACT_DIR where the built artifacts should be staged (the workflow
 *                uploads this dir)
 *
 * The module's build script is invoked as:
 *   node <module>/scripts/build-<id>.mjs --out <ARTIFACT_DIR> [--input-k <v> ...]
 * (module scripts also read INPUT_* env vars; the CLI flags are the
 * documented primary interface so the same script works locally).
 */

import { existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { findModuleById } from './lib/module-discovery.mjs'

function die(msg) {
  console.error(`[build-module] ${msg}`)
  process.exit(1)
}

function main() {
  const [moduleId] = process.argv.slice(2)
  if (!moduleId) die('usage: node scripts/build-module.mjs <module-id>')

  const found = findModuleById(moduleId)
  if (!found) die(`no module spec found for id '${moduleId}'`)
  const { spec, dir } = found
  const build = spec.build
  if (!build || build.recipe !== 'workflow' || !build.script) {
    die(`module '${moduleId}' has no workflow build script (build.recipe/script)`)
  }

  const scriptPath = resolve(dir, build.script)
  if (!existsSync(scriptPath)) {
    die(`build script missing: ${scriptPath}`)
  }

  // Stage built artifacts here; the workflow uploads this dir.
  const artifactDir = process.env.ARTIFACT_DIR || resolve(dir, 'assets')
  mkdirSync(artifactDir, { recursive: true })

  // Collect declared inputs from env (INPUT_<ID>), pass as --input-<id> flags.
  const args = ['--out', artifactDir]
  for (const input of build.inputs ?? []) {
    const envKey = `INPUT_${input.id.toUpperCase().replace(/-/g, '_')}`
    const value = process.env[envKey]
    if (value !== undefined) {
      args.push(`--input-${input.id}`, value)
    } else if (input.default !== undefined && !input.required) {
      args.push(`--input-${input.id}`, input.default)
    } else if (input.required) {
      die(`required input '${input.id}' missing (env ${envKey})`)
    }
  }

  console.log(`[build-module] ${moduleId}: ${scriptPath}`)
  console.log(`[build-module] artifact dir: ${artifactDir}`)
  const out = spawnSync('node', [scriptPath, ...args], {
    stdio: 'inherit',
    env: { ...process.env, MODULE_DIR: dir },
  })
  if (out.status !== 0) die(`build script exited ${out.status}`)
  console.log(`[build-module] done: ${moduleId} -> ${artifactDir}`)
}

main()
