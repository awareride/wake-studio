#!/usr/bin/env node
/**
 * Build the sherpa-onnx KWS WebAssembly runtime (module-owned build logic,
 * ADR-027 §6.7). The generic build workflow runs this via
 * scripts/build-module.mjs with the module's declared inputs.
 *
 * Logic extracted verbatim from the bespoke
 * .github/workflows/build-sherpa-onnx-kws-wasm.yml (2026-08-05) so the same
 * build runs through the shared skeleton - outputs and artifact name are
 * unchanged (sherpa-onnx-kws-wasm).
 *
 * Quirks preserved / updated (2026-08-06):
 *   - emsdk 4.0.23 (3.1.x fails to link std::filesystem for this onnxruntime)
 *   - build from sherpa-onnx **master** (NOT a release tag): upstream commit
 *     dcf56735 (#3836, 2026-08-04) removes WebAssembly pthread support
 *     entirely - the single-threaded wasm no longer needs COEP/SAB, fixing a
 *     boot hang in browsers without cross-origin isolation. The release tag
 *     (v1.13.4) predates it and still ships a pthread build. onnxruntime is
 *     bumped to 1.27.1 by the same commit.
 *   - CMake decoder-epoch patch kept (master's wasm/kws/CMakeLists.txt still
 *     hard-codes epoch-12 in its existence check; adapts to the downloaded
 *     model's epoch).
 *
 * Usage:
 *   node scripts/build-sherpa-kws.mjs \
 *     --out <artifact-dir> \
 *     [--input-sherpa_version master] [--input-emsdk_version 4.0.23] \
 *     [--input-kws_model <archive>]
 *
 * The default kws_model is the latest bilingual (zh+en) model
 * sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20 (see
 * https://k2-fsa.github.io/sherpa/onnx/kws/pretrained_models/index.html).

import { mkdirSync, rmSync, cpSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { spawnSync } from 'node:child_process'

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..', '..')
const MODULE_DIR = process.env.MODULE_DIR || REPO_ROOT

function die(msg) {
  console.error(`[build-sherpa-kws] ${msg}`)
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
  const sherpaVersion = args.inputs.sherpa_version || 'master'
  const emsdkVersion = args.inputs.emsdk_version || '4.0.23'
  const kwsModel =
    args.inputs.kws_model ||
    'sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20.tar.bz2'

  // 1. Checkout sherpa-onnx source. Defaults to master (which contains the
  //    upstream single-threaded wasm fix dcf56735 / #3836); a tag can be
  //    passed via --input-sherpa_version.
  const srcDir = join(MODULE_DIR, '.build-sherpa-onnx-src')
  rmSync(srcDir, { recursive: true, force: true })
  run('git', ['clone', '--depth', '1', '--branch', sherpaVersion,
    'https://github.com/k2-fsa/sherpa-onnx.git', srcDir])

  // 2. Download the KWS model into wasm/kws/assets (CMake FATAL_ERRORs otherwise).
  const assetsDir = join(srcDir, 'wasm', 'kws', 'assets')
  mkdirSync(assetsDir, { recursive: true })
  const expected = kwsModel.replace(/\.tar\.bz2$/, '')
  run('bash', ['-c', `
    set -euxo pipefail
    cd "${assetsDir}"
    URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/kws-models/${kwsModel}"
    for attempt in 1 2 3 4 5; do
      rm -rf ./*
      curl -fsSL "$URL" -o model.tar.bz2 || curl -fsSL "$URL?cb=$attempt" -o model.tar.bz2
      tar xf model.tar.bz2
      rm -f model.tar.bz2
      sub=\$(find . -maxdepth 1 -type d ! -name '.' | head -n1)
      if [ "\${sub##*/}" = "${expected}" ]; then
        mv -v "$sub"/* ./ && rmdir "$sub"
        echo "OK: correct model downloaded"; break
      fi
      echo "WARN: got wrong model archive, retrying..."; sleep 10
    done
    ls -lh
  `])

  // 3. Align the CMakeLists decoder epoch with the downloaded model.
  run('bash', ['-c', `
    set -euxo pipefail
    f="${srcDir}/wasm/kws/CMakeLists.txt"
    cd "${assetsDir}"
    present=\$(ls decoder-epoch-*-avg-2-chunk-16-left-64.onnx 2>/dev/null | head -n1 || true)
    if [ -n "$present" ]; then
      epoch=\$(echo "$present" | sed -E 's/decoder-epoch-([0-9]+)-.*/\\1/')
      sed -i "s/decoder-epoch-12-avg-2-chunk-16-left-64.onnx/decoder-epoch-\${epoch}-avg-2-chunk-16-left-64.onnx/g" "$f"
    fi
    echo '--- patched CMakeLists decoder ref ---'; grep -n "decoder-epoch" "$f" || true
  `])

  // 4. (Removed) pthread drop: upstream master dcf56735 (#3836) already
  //    removed -pthread from wasm/kws, so the wasm is single-threaded and
  //    needs no COEP/SAB. Do not re-apply a sed here - it would be a no-op on
  //    master and would mislead on older tags.

  // 5. Build via the upstream script (honors $EMSCRIPTEN from setup-emsdk).
  run('bash', ['-c', `
    set -euxo pipefail
    cd "${srcDir}"
    ./build-wasm-simd-kws.sh
    ls -lh build-wasm-simd-kws/install/bin/wasm
  `])

  // 6. Stage the artifact (same file set as the bespoke workflow's upload).
  const outDir = args.out
  mkdirSync(outDir, { recursive: true })
  const built = join(srcDir, 'build-wasm-simd-kws', 'install', 'bin', 'wasm')
  for (const f of [
    'sherpa-onnx-wasm-kws-main.js',
    'sherpa-onnx-wasm-kws-main.wasm',
    'sherpa-onnx-wasm-kws-main.data',
    'sherpa-onnx-kws.js',
  ]) {
    cpSync(join(built, f), join(outDir, f))
    console.log(`  ok: ${f}`)
  }
  console.log('Done. sherpa-onnx KWS wasm staged in', outDir)
}

main()
