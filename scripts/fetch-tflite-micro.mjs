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
 * Usage:
 *   node scripts/fetch-tflite-micro.mjs            # fetch runtime + model
 *   node scripts/fetch-tflite-micro.mjs --force    # re-fetch even if present
 *
 * Pins below. When bumping, update the SHA + sha256 together (sha256sum of
 * the downloaded tarball / model file).
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
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

function die(msg) {
  console.error(`[fetch-tflite-micro] ${msg}`)
  process.exit(1)
}

async function download(url) {
  const res = await fetch(url)
  if (!res.ok) {
    die(`download failed: HTTP ${res.status} ${res.statusText} (${url})`)
  }
  return Buffer.from(await res.arrayBuffer())
}

function verify(buf, expected, what) {
  const got = createHash('sha256').update(buf).digest('hex')
  if (got !== expected) {
    die(`sha256 mismatch for ${what}:\n  expected ${expected}\n  got      ${got}`)
  }
  console.log(`[fetch-tflite-micro] sha256 ok (${what})`)
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
