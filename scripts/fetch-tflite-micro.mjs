#!/usr/bin/env node
/**
 * Fetch the pinned TFLite-Micro runtime + micro-wake-word demo model
 * (issue #185; MCU-tier primary backend, ADR-019/020).
 *
 * TFLite-Micro is a live upstream project (ADR-037 Tier 1): we pin a commit
 * (ADR-031 style) instead of vendoring source. Upstream cuts no releases or
 * tags, so the pin is a commit SHA; the codeload source tarball is
 * sha256-verified and extracted to third_party/tflite-micro (gitignored —
 * fetched by this script, never committed; ADR-027 SOP spirit). The driver
 * (packages/modules/kws/microwakeword/device/) compiles a curated source
 * list from this tree only when WAKE_SDK_MICROWAKEWORD_HAS_RUNTIME=ON.
 *
 * The int8 demo model (okay_nabu) is not hosted on a WakeStudio release, so
 * it is fetched direct-URL from esphome/micro-wake-word-models at the pinned
 * ref below, sha256-verified, into the module's assets/ dir (gitignored,
 * ADR-011). It is the L1 real-inference model (slice 2) and the bundle
 * generator's default MCU model (#189). Migrate to a WakeStudio-hosted
 * release if the direct URL ever rots.
 *
 * TFLM parses models via its vendored schema (schema_generated.h), which
 * includes <flatbuffers/flatbuffers.h> — resolved by Bazel upstream, so this
 * script also fetches the pinned flatbuffers headers (TFLM MODULE.bazel pin:
 * 25.9.23) into third_party/flatbuffers (gitignored, headers only). The
 * reference kernels additionally need gemmlowp's fixedpoint headers
 * (<fixedpoint/fixedpoint.h>, MODULE.bazel pin fda83bdc, tensorflow.org
 * mirror) into third_party/gemmlowp (gitignored), the reference profilers
 * need ruy's instrumentation (MODULE.bazel pin 54774a7a, mirror) into
 * third_party/ruy (gitignored, only profiler/instrumentation.cc compiled),
 * and the microfrontend FFT needs kissfft (MODULE.bazel tag v130) into
 * third_party/kissfft (gitignored, TFLM's kissfft.patch applied).
 *
 * Usage:
 *   node scripts/fetch-tflite-micro.mjs            # fetch runtime + model
 *   node scripts/fetch-tflite-micro.mjs --force    # re-fetch even if present
 *
 * Pins below. When bumping, update the SHA + sha256 together (sha256sum of
 * the downloaded tarball / model file).
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { spawnSync } from 'node:child_process'

const TFLM_SHA = '0ee39f5fc6629b7403166d325da374f01d890cf1' // main @ 2026-09-21
const TFLM_TARBALL_SHA256 =
  '7a2f4c89c4cef517045900eb22bc63aa7f8858803f69aa1ac8a8dc76b9b4338b'
const TFLM_URL = `https://codeload.github.com/tensorflow/tflite-micro/tar.gz/${TFLM_SHA}`
const TFLM_MARKER = join('tensorflow', 'lite', 'micro', 'micro_interpreter.h')

const MODEL_REF = '05b65922cc433c9df13e98e32a7fe520758c837e' // main @ 2026-09-21
const MODEL_PATH = 'models/okay_nabu.tflite'
const MODEL_URL = `https://raw.githubusercontent.com/esphome/micro-wake-word-models/${MODEL_REF}/${MODEL_PATH}`
const MODEL_SHA256 =
  'f9af22ab15bf72a23157ac6d47593d48636ea6fbf65af57dc2ff7e65ad6769fe'
const MODEL_SIZE = 115400

// flatbuffers C++ headers — TFLM's own pinned dep (MODULE.bazel pins
// `flatbuffers 25.9.23`): the vendored schema parser (schema_generated.h)
// includes <flatbuffers/flatbuffers.h>, which TFLM resolves via Bazel.
// For our CMake build we fetch the matching release tarball (header-only
// use) into third_party/flatbuffers (gitignored, never committed).
const FLATBUFFERS_VERSION = '25.9.23'
const FLATBUFFERS_TARBALL_SHA256 =
  '9102253214dea6ae10c2ac966ea1ed2155d22202390b532d1dea64935c518ada'
const FLATBUFFERS_URL = `https://codeload.github.com/google/flatbuffers/tar.gz/refs/tags/v${FLATBUFFERS_VERSION}`
const FLATBUFFERS_MARKER = join('include', 'flatbuffers', 'flatbuffers.h')

// gemmlowp fixedpoint headers — TFLM's own pinned dep (MODULE.bazel pins
// commit fda83bdc, primary URL the tensorflow.org mirror): the reference
// kernels include <fixedpoint/fixedpoint.h>. Fetched (never committed) into
// third_party/gemmlowp, include root at the extracted tree root.
const GEMMLOWP_SHA = 'fda83bdc38b118cc6b56753bd540caa49e570745'
const GEMMLOWP_ZIP_SHA256 =
  '43146e6f56cb5218a8caaab6b5d1601a083f1f31c06ff474a4378a7d35be9cfb'
const GEMMLOWP_URL = `https://storage.googleapis.com/mirror.tensorflow.org/github.com/google/gemmlowp/archive/${GEMMLOWP_SHA}.zip`
const GEMMLOWP_MARKER = join('fixedpoint', 'fixedpoint.h')

// ruy profiler headers — TFLM's own pinned dep (MODULE.bazel pins commit
// 54774a7a, tensorflow.org mirror primary): the reference kernels include
// <ruy/profiler/instrumentation.h>. Fetched (never committed) into
// third_party/ruy; only profiler/instrumentation.cc is compiled.
const RUY_SHA = '54774a7a2cf85963777289193629d4bd42de4a59'
const RUY_ZIP_SHA256 =
  'da5ec0cc07472bdb21589b0b51c8f3d7f75d2ed6230b794912adf213838d289a'
const RUY_URL = `https://storage.googleapis.com/mirror.tensorflow.org/github.com/google/ruy/archive/${RUY_SHA}.zip`
const RUY_MARKER = join('ruy', 'profiler', 'instrumentation.h')

// kissfft — TFLM's own pinned dep (MODULE.bazel pins tag v130, mborgerding):
// the microfrontend FFT (kiss_fft_int16) #includes kiss_fft.c directly.
// Fetched (never committed) into third_party/kissfft, then TFLM's own
// kissfft.patch (third_party/tflite-micro/third_party/kissfft/) is applied
// (missing include guard + float-scalar fix — the build fails without it).
// Primary: the tag zip (sha256 below, matches MODULE.bazel). Fallback: the
// same tag's files via the jsDelivr GitHub mirror (per-file; the patch's
// context lines fail loudly if the content ever drifts).
const KISSFFT_TAG = 'v130'
const KISSFFT_ZIP_URL = `https://github.com/mborgerding/kissfft/archive/refs/tags/${KISSFFT_TAG}.zip`
const KISSFFT_ZIP_SHA256 =
  'ac2259f84e372a582270ed7c7b709d02e6ca9c7206e40bb58de6ef77f6474872'
const KISSFFT_CDN = `https://cdn.jsdelivr.net/gh/mborgerding/kissfft@${KISSFFT_TAG}`
const KISSFFT_FILES = ['kiss_fft.h', 'kiss_fft.c', '_kiss_fft_guts.h']
const KISSFFT_MARKER = 'kiss_fft.h'

function die(msg) {
  console.error(`[fetch-tflite-micro] ${msg}`)
  process.exit(1)
}

async function download(url) {
  // Bounded retries with backoff: CI/dev networks flake (connect timeouts,
  // TLS resets). After the last attempt the failure is loud (die) — no
  // mirror-guessing, per the ADR-011 operational rule.
  const attempts = 3;
  let last = null;
  for (let i = 1; i <= attempts; ++i) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        die(`download failed: HTTP ${res.status} ${res.statusText} (${url})`);
      }
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      last = e;
      console.error(
        `[fetch-tflite-micro] attempt ${i}/${attempts} failed (${url}): ${e?.cause?.code || e.message}`,
      );
      if (i < attempts) {
        await new Promise((r) => setTimeout(r, 2000 * i));
      }
    }
  }
  die(`download failed after ${attempts} attempts (${url}): ${last?.cause?.code || last?.message}`);
}

function verify(buf, expected, what) {
  const got = createHash('sha256').update(buf).digest('hex')
  if (got !== expected) {
    die(`sha256 mismatch for ${what}:\n  expected ${expected}\n  got      ${got}`)
  }
  console.log(`[fetch-tflite-micro] sha256 ok (${what})`)
}

/** Hoist a zip's single top dir (name starts with prefix) into dest. */
function hoistTopDir(tmpDir, prefix, dest) {
  const tops = readdirSync(tmpDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith(prefix))
  rmSync(dest, { recursive: true, force: true })
  mkdirSync(dest, { recursive: true })
  if (tops.length !== 1) {
    rmSync(tmpDir, { recursive: true, force: true })
    die(`zip layout unexpected (no single ${prefix}*/ top dir)`)
  }
  for (const e of readdirSync(join(tmpDir, tops[0].name))) {
    renameSync(join(tmpDir, tops[0].name, e), join(dest, e))
  }
  rmSync(tmpDir, { recursive: true, force: true })
}

/**
 * Apply TFLM's own kissfft.patch inside kissDir (missing include guard +
 * float-scalar fix — the microfrontend FFT fails to compile without it).
 * patch's context lines fail loudly if the pinned content ever drifts.
 */
function applyKissfftPatch(repoRoot, kissDir) {
  const patchFile = resolve(
    repoRoot, 'third_party', 'tflite-micro', 'third_party', 'kissfft', 'kissfft.patch')
  if (!existsSync(patchFile)) {
    die(`kissfft patch not found (TFLM tree incomplete?): ${patchFile}`)
  }
  const out = spawnSync('patch', ['-p1', '-i', patchFile], { cwd: kissDir })
  if (out.status !== 0) {
    die(`kissfft.patch failed to apply in ${kissDir} (content drift?)`)
  }
  console.log('[fetch-tflite-micro] kissfft.patch applied')
}

async function main() {
  const force = process.argv.includes('--force')
  const repoRoot = resolve(import.meta.dirname, '..')

  // --- TFLite-Micro runtime source -----------------------------------------
  const tflmDir = join(repoRoot, 'third_party', 'tflite-micro')
  if (!force && existsSync(join(tflmDir, TFLM_MARKER))) {
    console.log(`[fetch-tflite-micro] runtime already fetched at ${tflmDir}`)
  } else {
    console.log(`[fetch-tflite-micro] downloading ${TFLM_URL}`)
    const buf = await download(TFLM_URL)
    verify(buf, TFLM_TARBALL_SHA256, `tflite-micro@${TFLM_SHA.slice(0, 12)}`)
    rmSync(tflmDir, { recursive: true, force: true })
    mkdirSync(tflmDir, { recursive: true })
    const tmpTgz = join(repoRoot, 'third_party', `.tflite-micro.${TFLM_SHA.slice(0, 12)}.tar.gz`)
    writeFileSync(tmpTgz, buf)
    const tar = spawnSync('tar', ['xzf', tmpTgz, '-C', tflmDir, '--strip-components=1'], {
      stdio: 'inherit',
    })
    rmSync(tmpTgz, { force: true })
    if (tar.status !== 0) {
      die(`extraction failed (tar exit ${tar.status})`)
    }
    if (!existsSync(join(tflmDir, TFLM_MARKER))) {
      die(`marker missing after extract: ${TFLM_MARKER}`)
    }
    console.log(`[fetch-tflite-micro] runtime -> ${tflmDir} (tflite-micro ${TFLM_SHA.slice(0, 12)})`)
  }

  // --- flatbuffers headers (TFLM schema dep) --------------------------------
  const fbDir = join(repoRoot, 'third_party', 'flatbuffers')
  if (!force && existsSync(join(fbDir, FLATBUFFERS_MARKER))) {
    console.log(`[fetch-tflite-micro] flatbuffers already fetched at ${fbDir}`)
  } else {
    console.log(`[fetch-tflite-micro] downloading ${FLATBUFFERS_URL}`)
    const buf = await download(FLATBUFFERS_URL)
    verify(buf, FLATBUFFERS_TARBALL_SHA256, `flatbuffers@${FLATBUFFERS_VERSION}`)
    rmSync(fbDir, { recursive: true, force: true })
    mkdirSync(fbDir, { recursive: true })
    const tmpTgz = join(repoRoot, 'third_party', `.flatbuffers.${FLATBUFFERS_VERSION}.tar.gz`)
    writeFileSync(tmpTgz, buf)
    const tar = spawnSync('tar', ['xzf', tmpTgz, '-C', fbDir, '--strip-components=1'], {
      stdio: 'inherit',
    })
    rmSync(tmpTgz, { force: true })
    if (tar.status !== 0) {
      die(`extraction failed (tar exit ${tar.status})`)
    }
    if (!existsSync(join(fbDir, FLATBUFFERS_MARKER))) {
      die(`marker missing after extract: ${FLATBUFFERS_MARKER}`)
    }
    console.log(`[fetch-tflite-micro] flatbuffers -> ${fbDir} (${FLATBUFFERS_VERSION})`)
  }

  // --- gemmlowp fixedpoint headers (TFLM kernel dep) --------------------------
  const gemmDir = join(repoRoot, 'third_party', 'gemmlowp')
  if (!force && existsSync(join(gemmDir, GEMMLOWP_MARKER))) {
    console.log(`[fetch-tflite-micro] gemmlowp already fetched at ${gemmDir}`)
  } else {
    console.log(`[fetch-tflite-micro] downloading ${GEMMLOWP_URL}`)
    const buf = await download(GEMMLOWP_URL)
    verify(buf, GEMMLOWP_ZIP_SHA256, `gemmlowp@${GEMMLOWP_SHA.slice(0, 12)}`)
    rmSync(gemmDir, { recursive: true, force: true })
    mkdirSync(gemmDir, { recursive: true })
    const tmpZip = join(repoRoot, 'third_party', `.gemmlowp.${GEMMLOWP_SHA.slice(0, 12)}.zip`)
    writeFileSync(tmpZip, buf)
    const tmpDir = join(repoRoot, 'third_party', `.gemmlowp-extract`)
    rmSync(tmpDir, { recursive: true, force: true })
    mkdirSync(tmpDir, { recursive: true })
    const unzip = spawnSync('unzip', ['-q', tmpZip, '-d', tmpDir], { stdio: 'inherit' })
    rmSync(tmpZip, { force: true })
    if (unzip.status !== 0) {
      rmSync(tmpDir, { recursive: true, force: true })
      die(`extraction failed (unzip exit ${unzip.status})`)
    }
    // The zip wraps one top-level dir (gemmlowp-<sha>); hoist its contents.
    hoistTopDir(tmpDir, 'gemmlowp-', gemmDir)
    if (!existsSync(join(gemmDir, GEMMLOWP_MARKER))) {
      die(`marker missing after extract: ${GEMMLOWP_MARKER}`)
    }
    console.log(`[fetch-tflite-micro] gemmlowp -> ${gemmDir} (${GEMMLOWP_SHA.slice(0, 12)})`)
  }

  // --- ruy profiler headers (TFLM kernel dep) ----------------------------------
  const ruyDir = join(repoRoot, 'third_party', 'ruy')
  if (!force && existsSync(join(ruyDir, RUY_MARKER))) {
    console.log(`[fetch-tflite-micro] ruy already fetched at ${ruyDir}`)
  } else {
    console.log(`[fetch-tflite-micro] downloading ${RUY_URL}`)
    const buf = await download(RUY_URL)
    verify(buf, RUY_ZIP_SHA256, `ruy@${RUY_SHA.slice(0, 12)}`)
    rmSync(ruyDir, { recursive: true, force: true })
    mkdirSync(ruyDir, { recursive: true })
    const tmpZip = join(repoRoot, 'third_party', `.ruy.${RUY_SHA.slice(0, 12)}.zip`)
    writeFileSync(tmpZip, buf)
    const tmpDir = join(repoRoot, 'third_party', `.ruy-extract`)
    rmSync(tmpDir, { recursive: true, force: true })
    mkdirSync(tmpDir, { recursive: true })
    const unzip = spawnSync('unzip', ['-q', tmpZip, '-d', tmpDir], { stdio: 'inherit' })
    rmSync(tmpZip, { force: true })
    if (unzip.status !== 0) {
      rmSync(tmpDir, { recursive: true, force: true })
      die(`extraction failed (unzip exit ${unzip.status})`)
    }
    hoistTopDir(tmpDir, 'ruy-', ruyDir)
    if (!existsSync(join(ruyDir, RUY_MARKER))) {
      die(`marker missing after extract: ${RUY_MARKER}`)
    }
    console.log(`[fetch-tflite-micro] ruy -> ${ruyDir} (${RUY_SHA.slice(0, 12)})`)
  }

  // --- kissfft (microfrontend FFT dep) ---------------------------------------
  const kissDir = join(repoRoot, 'third_party', 'kissfft')
  if (!force && existsSync(join(kissDir, KISSFFT_MARKER))) {
    console.log(`[fetch-tflite-micro] kissfft already fetched at ${kissDir}`)
  } else {
    let haveZip = false
    try {
      console.log(`[fetch-tflite-micro] downloading ${KISSFFT_ZIP_URL}`)
      const buf = await download(KISSFFT_ZIP_URL)
      verify(buf, KISSFFT_ZIP_SHA256, `kissfft@${KISSFFT_TAG}`)
      rmSync(kissDir, { recursive: true, force: true })
      mkdirSync(kissDir, { recursive: true })
      const tmpZip = join(repoRoot, 'third_party', `.kissfft.${KISSFFT_TAG}.zip`)
      writeFileSync(tmpZip, buf)
      const tmpDir = join(repoRoot, 'third_party', `.kissfft-extract`)
      rmSync(tmpDir, { recursive: true, force: true })
      mkdirSync(tmpDir, { recursive: true })
      const unzip = spawnSync('unzip', ['-q', tmpZip, '-d', tmpDir], { stdio: 'inherit' })
      rmSync(tmpZip, { force: true })
      if (unzip.status !== 0) {
        rmSync(tmpDir, { recursive: true, force: true })
        throw new Error(`unzip exit ${unzip.status}`)
      }
      hoistTopDir(tmpDir, 'kissfft-', kissDir)
      haveZip = true
    } catch (e) {
      console.error(`[fetch-tflite-micro] tag zip failed (${e.message}); falling back to CDN files`)
      rmSync(kissDir, { recursive: true, force: true })
      mkdirSync(kissDir, { recursive: true })
      for (const name of KISSFFT_FILES) {
        const file = await download(`${KISSFFT_CDN}/${name}`)
        writeFileSync(join(kissDir, name), file)
        console.log(`[fetch-tflite-micro] CDN ok (${file.length} bytes): ${name}`)
      }
    }
    applyKissfftPatch(repoRoot, kissDir)
    if (!existsSync(join(kissDir, KISSFFT_MARKER))) {
      die(`marker missing after extract: ${KISSFFT_MARKER}`)
    }
    console.log(`[fetch-tflite-micro] kissfft -> ${kissDir} (${KISSFFT_TAG})`)
  }

  // --- micro-wake-word demo model -------------------------------------------
  const assetsDir = join(
    repoRoot,
    'packages',
    'modules',
    'kws',
    'microwakeword',
    'assets',
  )
  const modelDest = join(assetsDir, 'okay_nabu.tflite')
  if (!force && existsSync(modelDest)) {
    console.log(`[fetch-tflite-micro] model already fetched at ${modelDest}`)
  } else {
    console.log(`[fetch-tflite-micro] downloading ${MODEL_URL}`)
    const buf = await download(MODEL_URL)
    verify(buf, MODEL_SHA256, MODEL_PATH)
    if (buf.length !== MODEL_SIZE) {
      die(`size mismatch for ${MODEL_PATH}: expected ${MODEL_SIZE}, got ${buf.length}`)
    }
    mkdirSync(assetsDir, { recursive: true })
    writeFileSync(modelDest, buf)
    console.log(`[fetch-tflite-micro] model -> ${modelDest} (${buf.length} bytes)`)
  }
}

main().catch((e) => {
  console.error('[fetch-tflite-micro]', e)
  process.exit(1)
})
