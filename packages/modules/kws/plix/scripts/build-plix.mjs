#!/usr/bin/env node
/**
 * Build the PLiX Few-Shot encoder ONNX artifact (module-owned build logic,
 * ADR-027 §6.7). The generic build workflow runs this via
 * scripts/build-module.mjs with the module's declared inputs.
 *
 * The actual torch/ONNX export stays in Python
 * (apps/web/scripts/export-plixkws-onnx.py - the toolchain lives in CI via
 * `uv`/python). This script wires the module's declared inputs to that
 * exporter and stages the artifacts (flat ONNX + HF-style dir) under --out.
 *
 * Usage:
 *   node scripts/build-plix.mjs --out <artifact-dir> \
 *     [--input-encoder base] [--input-language en] [--input-opset 18]
 */

import { mkdirSync, cpSync, existsSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..')
const MODULE_DIR = process.env.MODULE_DIR || REPO_ROOT

function die(msg) {
  console.error(`[build-plix] ${msg}`)
  process.exit(1)
}

function run(cmd, args, opts = {}) {
  const out = spawnSync(cmd, args, { stdio: 'inherit', ...opts })
  if (out.status !== 0) die(`command failed (${out.status}): ${cmd} ${args.join(' ')}`)
}

function parseArgs(argv) {
  const args = { out: null, inputs: {} }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--out') args.out = argv[++i]
    else if (a.startsWith('--input-')) {
      args.inputs[a.slice('--input-'.length)] = argv[++i]
    }
  }
  return args
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.out) die('--out <artifact-dir> required')
  const encoder = args.inputs.encoder || 'base'
  const language = args.inputs.language || 'en'
  const opset = args.inputs.opset || '18'

  const exporter = resolve(
    REPO_ROOT,
    'apps/web/scripts/export-plixkws-onnx.py',
  )
  if (!existsSync(exporter)) die(`exporter missing: ${exporter}`)

  const flatOnnx = join(args.out, `plixkws-${encoder}.onnx`)
  const hfDir = join(args.out, 'hf', 'plixkws')
  mkdirSync(dirname(flatOnnx), { recursive: true })

  run('python', [
    exporter,
    '--encoder', encoder,
    '--language', language,
    '--opset', opset,
    '--out', flatOnnx,
    '--hf-dir', hfDir,
  ])

  console.log('Done. PLiX ONNX staged in', args.out)
}

main()
