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
 *   packages/modules/kws/plix/assets/hf/plixkws/
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
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')

/** Variants and the source ONNX (relative to the plix module assets dir). */
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
'transers' runtime can load it offline (packages/modules/kws/plix/assets/hf/plixkws).
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

  // Q-K2: the plix module owns its assets (served at
  // /modules/kws/plix/assets/...). The HF-style dir is generated there.
  const baseDir = join(
    repoRoot,
    '..',
    '..',
    'packages',
    'modules',
    'kws',
    'plix',
    'assets',
  )
  const srcOnnx = join(baseDir, src.onnx)
  const hfDir = join(baseDir, 'hf', 'plixkws')
  const onnxDir = join(hfDir, 'onnx')

  if (!existsSync(srcOnnx)) {
    console.error(
      `Missing source ONNX: ${srcOnnx}\n` +
        `Export it first (see packages/modules/kws/plix/assets/README.md), then re-run this script.`,
    )
    process.exit(1)
  }

  await mkdir(onnxDir, { recursive: true })

  // Write the graph under the name Transformers.js expects (`model.onnx`),
  // with its external-data `location` rewritten to `model.onnx_data`.
  // Transformers.js / onnxruntime-web resolves external data in the browser
  // via a HARDCODED `_data` naming convention: it looks for `<graph>_data`
  // (i.e. `model.onnx_data`), IGNORING the protobuf `location` and ALSO
  // ignoring any `externalData` option we pass when external tensors are
  // detected. So the graph's external `location` MUST be `model.onnx_data` to
  // match. We use the `onnx` Python package for a correct, corruption-free
  // protobuf rewrite (the source ONNX is never modified).
  const destOnnx = join(onnxDir, 'model.onnx')
  await rewriteExternalLocation(srcOnnx, destOnnx, 'plixkws-small.onnx.data', 'model.onnx_data')
  console.log(`wrote hf/plixkws/onnx/model.onnx (external location -> model.onnx_data)`)

  // Copy external weights (small only) so they stay co-located.
  //
  // IMPORTANT: Transformers.js / onnxruntime-web resolves external data in the
  // browser via a HARDCODED `_data` naming convention - it looks for
  // `<graph-without-.onnx>_data` (i.e. `model.onnx_data`), NOT the protobuf
  // `location` (`plixkws-small.onnx.data`). So the file MUST be named
  // `model.onnx_data` for the transformers runtime to load it. We also keep a
  // copy named `plixkws-small.onnx.data` (the protobuf location) as a
  // fallback and so the same dir can serve ORT-web's alternate lookup.
  if (src.external) {
    const srcExternal = join(baseDir, src.external)
    if (!existsSync(srcExternal)) {
      console.error(
        `Missing external weights: ${srcExternal}\n` +
          `The '${variant}' export needs its .onnx.data sidecar. Export it and re-run.`,
      )
      process.exit(1)
    }
    const destExternalData = join(onnxDir, 'model.onnx_data')
    await copyFile(srcExternal, destExternalData)
    console.log(`copied ${src.external} -> hf/plixkws/onnx/model.onnx_data`)
    const destFallback = join(onnxDir, src.external)
    await copyFile(srcExternal, destFallback)
    console.log(`copied ${src.external} -> hf/plixkws/onnx/${src.external} (fallback)`)
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

/**
 * Rewrite the ONNX external-data `location` of every initializer from `from`
 * to `to`, keeping the weights external (single sidecar file named `to`), and
 * write the result to `destOnnx`. Uses the `onnx` Python package so the
 * protobuf is re-serialized correctly (no fragile byte patching). The source
 * ONNX is never modified. Required because onnxruntime-web (inside
 * Transformers.js) only honours the `_data` convention (`<graph>_data`), not
 * the protobuf `location`, when external tensors are present.
 */
async function rewriteExternalLocation(srcOnnx, destOnnx, from, to) {
  const dir = await mkdtemp(join(tmpdir(), 'gen-plix-'))
  const py = join(dir, 'rewrite.py')
  await writeFile(
    py,
    `import sys\n` +
      `import onnx\n` +
      `src, dst, frm, to = sys.argv[1:5]\n` +
      `m = onnx.load(src, load_external_data=False)\n` +
      `n = 0\n` +
      `for init in m.graph.initializer:\n` +
      `    for ext in init.external_data:\n` +
      `        if ext.key == "location" and ext.value == frm:\n` +
      `            ext.value = to\n` +
      `            n += 1\n` +
      `onnx.save(m, dst, save_as_external_data=True, all_tensors_to_one_file=True, location=to)\n` +
      `print(f"rewrote {n} external-data locations -> {to}")\n`,
  )
  try {
    const { stdout } = await execFileAsync('python3', [py, srcOnnx, destOnnx, from, to], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    process.stdout.write(stdout)
  } catch (err) {
    const msg = err.stderr ? err.stderr.toString() : err.message
    throw new Error(
      `Failed to rewrite ONNX external location via python 'onnx' (is it installed? ` +
        `pip install onnx). ${msg}`,
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
