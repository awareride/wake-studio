/**
 * kws-plix - HF-style local dir completeness for the transformers runtime
 * (ADR-026 L1, #48).
 *
 * The 'transformers' runtime (encoders/plix-transformers.ts) loads the model
 * from a locally-served HF-style dir (`/modules/kws/plix/assets/hf/plixkws`)
 * instead of the Hub: it needs `config.json` + `onnx/model.onnx` (+ external
 * data `model.onnx_data`). This suite guards that the fetched assets contain
 * everything the runtime requires, so a partial fetch is caught in CI without
 * a browser. Skips when the (gitignored) assets are absent.
 */
import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const hfDir = resolve(here, '../assets/hf/plixkws')
const requiredFiles = [
  'config.json',
  'onnx/model.onnx',
  'onnx/model.onnx_data',
] as const

const ASSETS_PRESENT = existsSync(resolve(hfDir, requiredFiles[0]))

describe.skipIf(!ASSETS_PRESENT)('plix transformers runtime assets (L1, #48)', () => {
  it('the HF-style local dir has every file the transformers runtime needs', () => {
    for (const rel of requiredFiles) {
      expect(
        existsSync(resolve(hfDir, rel)),
        `missing ${rel} under assets/hf/plixkws/ (run pnpm fetch:all)`,
      ).toBe(true)
    }
    // The runtime splits the local path into base dir + model id
    // (<localModelPath>/<id>/...): the id must be the last path segment.
    const config = resolve(hfDir, 'config.json')
    expect(existsSync(config)).toBe(true)
  })
})
