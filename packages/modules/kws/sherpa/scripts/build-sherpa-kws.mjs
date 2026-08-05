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
 * Quirks preserved:
 *   - emsdk 4.0.23 (3.1.x fails to link std::filesystem for this onnxruntime)
 *   - single-threaded build (drop -pthread; avoids COEP/SAB requirements)
 *   - CMake decoder-epoch patch to match the actually-downloaded model
 *
 * Usage:
 *   node scripts/build-sherpa-kws.mjs \
 *     --out <artifact-dir> \
 *     [--input-sherpa_version v1.13.4] [--input-emsdk_version 4.0.23] \
 *     [--input-kws_model <archive>]
 */

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
  const sherpaVersion = args.inputs.sherpa_version || 'v1.13.4'
  const emsdkVersion = args.inputs.emsdk_version || '4.0.23'
  const kwsModel =
    args.inputs.kws_model ||
    'sherpa-onnx-kws-zipformer-wenetspeech-3.3M-2024-01-01.tar.bz2'

  // 1. Checkout sherpa-onnx source at the pinned tag.
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
      sub=$(find . -maxdepth 1 -type d ! -name '.' | head -n1)
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
    present=$(ls decoder-epoch-*-avg-2-chunk-16-left-64.onnx 2>/dev/null | head -n1 || true)
    if [ -n "$present" ]; then
      epoch=$(echo "$present" | sed -E 's/decoder-epoch-([0-9]+)-.*/\\1/')
      sed -i "s/decoder-epoch-12-avg-2-chunk-16-left-64.onnx/decoder-epoch-\${epoch}-avg-2-chunk-16-left-64.onnx/g" "$f"
    fi
    echo '--- patched CMakeLists decoder ref ---'; grep -n "decoder-epoch" "$f" || true
  `])

  // 4. Drop pthreads (single-threaded wasm; no COEP/SAB needed).
  run('bash', ['-c', `
    set -euxo pipefail
    f="${srcDir}/wasm/kws/CMakeLists.txt"
    sed -i 's/ -pthread -sPTHREAD_POOL_SIZE=4//g' "$f"
  `])

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
