#!/usr/bin/env node
/**
 * Build the kws-streaming ONNX artifact (module-owned build logic, ADR-027
 * §6.7). The generic build workflow runs this via scripts/build-module.mjs
 * with the module's declared inputs.
 *
 * What it does:
 *   1. Clones the checkpoint repo (default: ARM-software/keyword-transformer,
 *      which publishes `kws_streaming`-family checkpoints trained on Speech
 *      Commands V2 with 12 labels).
 *   2. Runs the Python exporter (TFLite -> ONNX + sidecar manifest) once per
 *      requested checkpoint, verifying each graph with one onnxruntime pass.
 *   3. Stages `<name>.onnx` + `<name>.json` into --out for upload.
 *
 * The torch/TF toolchain stays in Python (scripts/export-kws-streaming-onnx.py)
 * and only ever runs in CI: TensorFlow ships no arm64-macOS wheels for these
 * versions, so dev machines fetch the artifact instead (ADR-027 SOP).
 *
 * Usage:
 *   node scripts/build-kws-streaming.mjs --out <artifact-dir> \
 *     [--input-checkpoint_repo https://github.com/ARM-software/keyword-transformer] \
 *     [--input-checkpoint_ref master] \
 *     [--input-checkpoints kwt1,kwt2,kwt3,att_mh_rnn_1] \
 *     [--input-checkpoint_root models_data_v2_12_labels] \
 *     [--input-opset 17] [--input-hop_ms 100]
 */

import { mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { spawnSync } from 'node:child_process'

const MODULE_DIR = process.env.MODULE_DIR || resolve(import.meta.dirname, '..')

function die(msg) {
  console.error(`[build-kws-streaming] ${msg}`)
  process.exit(1)
}

function run(cmd, args, opts = {}) {
  console.log(`[build-kws-streaming] $ ${cmd} ${args.join(' ')}`)
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

/** Python deps for the exporter. Pinned: tf2onnx is sensitive to TF majors. */
const PY_DEPS = [
  'tensorflow-cpu==2.15.1',
  'tf2onnx==1.16.1',
  'onnx==1.16.2',
  'onnxruntime==1.19.2',
  'numpy<2',
  'protobuf<5',
]

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.out) die('--out <artifact-dir> required')

  const repoUrl =
    args.inputs.checkpoint_repo ||
    'https://github.com/ARM-software/keyword-transformer'
  const repoRef = args.inputs.checkpoint_ref || 'master'
  const checkpointRoot = args.inputs.checkpoint_root || 'models_data_v2_12_labels'
  const names = (args.inputs.checkpoints || 'kwt1,kwt2,kwt3,att_mh_rnn_1')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const opset = args.inputs.opset || '17'
  const hopMs = args.inputs.hop_ms || '100'

  if (names.length === 0) die('no checkpoints requested')

  const outDir = args.out
  mkdirSync(outDir, { recursive: true })

  // 1. Clone the checkpoint repo (shallow; the weights are the payload).
  const srcDir = join(MODULE_DIR, '.build-checkpoints')
  rmSync(srcDir, { recursive: true, force: true })
  run('git', ['clone', '--depth', '1', '--branch', repoRef, repoUrl, srcDir])

  const rootDir = join(srcDir, checkpointRoot)
  if (!existsSync(rootDir)) {
    die(
      `checkpoint root '${checkpointRoot}' not found in ${repoUrl}@${repoRef}; ` +
        `top level: ${readdirSync(srcDir).join(', ')}`,
    )
  }

  // 2. Install the Python toolchain (CI-only; see the header).
  run('python3', ['-m', 'pip', 'install', '--quiet', '--upgrade', 'pip'])
  run('python3', ['-m', 'pip', 'install', '--quiet', ...PY_DEPS])

  // 3. Export each checkpoint. One failing checkpoint must not silently
  //    produce a half-empty artifact, so we fail the whole build.
  const exporter = join(MODULE_DIR, 'scripts', 'export-kws-streaming-onnx.py')
  for (const name of names) {
    const checkpoint = join(rootDir, name)
    if (!existsSync(checkpoint)) {
      die(
        `checkpoint '${name}' not found under ${checkpointRoot}; ` +
          `available: ${readdirSync(rootDir).join(', ')}`,
      )
    }
    console.log(`\n[build-kws-streaming] === ${name} ===`)
    run('python3', [
      exporter,
      '--checkpoint', checkpoint,
      '--out', outDir,
      '--name', name,
      '--opset', String(opset),
      '--mode', 'sliding-window',
      '--hop-ms', String(hopMs),
      '--source', `${repoUrl}/tree/${repoRef}/${checkpointRoot}/${name}`,
      '--upstream-ref', repoRef,
    ])
  }

  console.log('\n[build-kws-streaming] staged artifacts:')
  for (const f of readdirSync(outDir).sort()) console.log(`  ${f}`)
  console.log('Done. kws-streaming ONNX staged in', outDir)
}

main()
