#!/usr/bin/env node
/**
 * Generate a locally-served Hugging Face-style directory for the PLiX Few-Shot
 * encoder, so the `transformers` runtime can load it fully offline.
 *
 * The PLiX repo on the Hub (aaqibsaeed/plixkws) only ships `.pt` PyTorch
 * weights + config.json - it has NO ONNX graph - so the transformers runtime
 * cannot fetch it from the Hub. Instead it loads the ONNX graph from a
 * locally-built HF-style dir:
 *
 *   prebuilts/plixkws/hf/plixkws/
 *   ├── config.json
 *   └── onnx/
 *       ├── model.onnx            (== plixkws-small.onnx, renamed)
 *       └── plixkws-small.onnx.data (external weights; 'small' only)
 *
 * Transformers.js looks for `onnx/model.onnx` by default, so the exported
 * graph is copied (not moved) and renamed; the external weights stay
 * co-located so onnxruntime-web can resolve them (the protobuf `location`
 * `plixkws-small.onnx.data` resolves relative to the graph dir).
 *
 * This folder is gitignored (ADR-011) - a generated, dev-only artifact. Run:
 *
 *   node scripts/gen-plix-hf-dir.mjs            # defaults to 'small'
 *   node scripts/gen-plix-hf-dir.mjs --variant base
 *
 * or via the npm script:
 *
 *   npm run gen-plix-hf-dir -- --variant base
 */

import { existsSync } from 'node:fs'
import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')

/** Variants and the source ONNX (relative to prebuilts/plixkws). */
const VARIANTS = {
  base: { onnx: 'plixkws-base.onnx', external: null },
  small: { onnx: 'plixkws-small.onnx', external: 'plixkws-small.onnx.data' },
}

const EMBEDDING_DIM = 1280
const NUM_MELS = 64
const NUM_FRAMES = 100

function parseArgs(argv) {
  const args = { variant: 'small' }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--variant') {
      args.variant = argv[++i]
    } else if (a.startsWith('--variant=')) {
      args.variant = a.slice('--variant='.length)
    } else if (a === '--help' || a === '-h') {
      args.help = true
    }
  }
  return args
}

function usage() {
  return `usage: node scripts/gen-plix-hf-dir.mjs [--variant base|small]

Generate a locally-served HF-style dir for the PLiX Few-Shot encoder so the
'transers' runtime can load it offline (prebuilts/plixkws/hf/plixkws).
Default variant: small.`
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(usage())
    return
  }

  const variant = args.variant
  const src = VARIANTS[variant]
  if (!src) {
    console.error(`Unknown variant '${variant}'. Choose one of: ${Object.keys(VARIANTS).join(', ')}.`)
    process.exit(2)
  }

  const baseDir = join(repoRoot, 'prebuilts', 'plixkws')
  const srcOnnx = join(baseDir, src.onnx)
  const hfDir = join(baseDir, 'hf', 'plixkws')
  const onnxDir = join(hfDir, 'onnx')

  if (!existsSync(srcOnnx)) {
    console.error(
      `Missing source ONNX: ${srcOnnx}\n` +
        `Export it first (see prebuilts/plixkws/README.md), then re-run this script.`,
    )
    process.exit(1)
  }

  await mkdir(onnxDir, { recursive: true })

  // Copy + rename the graph to the name Transformers.js expects.
  const destOnnx = join(onnxDir, 'model.onnx')
  await copyFile(srcOnnx, destOnnx)
  console.log(`copied ${src.onnx} -> hf/plixkws/onnx/model.onnx`)

  // Copy external weights (small only) so they stay co-located.
  if (src.external) {
    const srcExternal = join(baseDir, src.external)
    if (!existsSync(srcExternal)) {
      console.error(
        `Missing external weights: ${srcExternal}\n` +
          `The '${variant}' export needs its .onnx.data sidecar. Export it and re-run.`,
      )
      process.exit(1)
    }
    const destExternal = join(onnxDir, src.external)
    await copyFile(srcExternal, destExternal)
    console.log(`copied ${src.external} -> hf/plixkws/onnx/${src.external}`)
  }

  // Write a minimal config.json describing the backbone.
  const config = {
    _name_or_path: 'plixkws',
    architectures: ['PlixBackbone'],
    model_type: 'plixkws',
    num_channels: 1,
    num_mels: NUM_MELS,
    num_frames: NUM_FRAMES,
    embedding_dim: EMBEDDING_DIM,
    onnx: { model: 'onnx/model.onnx' },
  }
  await writeFile(join(hfDir, 'config.json'), JSON.stringify(config, null, 2) + '\n')
  console.log('wrote hf/plixkws/config.json')

  console.log(`\nDone. The 'transformers' runtime now loads from:\n  ${hfDir}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
