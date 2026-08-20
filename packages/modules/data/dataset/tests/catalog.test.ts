/**
 * Dataset module - built-in catalog tests (#207).
 *
 * Covers the catalog contract + validation: every shipped entry is a valid
 * built-in manifest with license + commercialUse (the export-gate input) and
 * a materialize descriptor. The curated file (`catalog/builtins.json`) is the
 * fixture — the same file `scripts/build-dataset-catalog.mjs` emits to the
 * web bundle and the backend `builtin_catalog.py` mirrors.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  isBuiltinAvailable,
  validateDatasetCatalog,
  type DatasetCatalogEntry,
  type DatasetBuiltinCatalog,
} from '../core/catalog'
import { validateDatasetManifest } from '../core/spec'

const SHIPPED = JSON.parse(
  readFileSync(resolve(__dirname, '..', 'catalog', 'builtins.json'), 'utf8'),
) as DatasetBuiltinCatalog

function entry(id: string): DatasetCatalogEntry {
  return SHIPPED.datasets.find((d) => d.id === id)!
}

describe('shipped built-in catalog (catalog/builtins.json)', () => {
  it('is a valid catalog', () => {
    const v = validateDatasetCatalog(SHIPPED)
    expect(v.ok, v.errors.join('; ')).toBe(true)
  })

  it('has every v1 candidate with license + commercialUse', () => {
    const ids = SHIPPED.datasets.map((d) => d.id)
    expect(ids).toContain('speech-commands-v2')
    expect(ids).toContain('google-speech-commands')
    expect(ids).toContain('common-voice')
    expect(ids).toContain('audioset-fma-noise')

    for (const e of SHIPPED.datasets) {
      expect(e.kind).toBe('builtin')
      expect(e.provenance.length).toBeGreaterThan(0)
      expect(typeof e.provenance[0].commercialUse).toBe('boolean')
    }
    // research-use noise is NOT commercially usable (the export gate must block it)
    expect(entry('audioset-fma-noise').provenance[0].commercialUse).toBe(false)
    expect(entry('speech-commands-v2').provenance[0].commercialUse).toBe(true)
  })

  it('SC2 is fully materializable today; the rest are declared (pending-host)', () => {
    expect(isBuiltinAvailable(entry('speech-commands-v2'))).toBe(true)
    expect(isBuiltinAvailable(entry('common-voice'))).toBe(false)
    expect(isBuiltinAvailable(entry('audioset-fma-noise'))).toBe(false)
  })

  it('every entry is a valid DatasetManifest (the picker + store contract)', () => {
    for (const e of SHIPPED.datasets) {
      const v = validateDatasetManifest(e)
      expect(v.ok, `${e.id}: ${v.errors.join('; ')}`).toBe(true)
    }
  })
})

describe('validateDatasetCatalog', () => {
  it('rejects a duplicate dataset id', () => {
    const dup: DatasetBuiltinCatalog = {
      schemaVersion: 1,
      datasets: [entry('speech-commands-v2'), entry('speech-commands-v2')],
    }
    const v = validateDatasetCatalog(dup)
    expect(v.ok).toBe(false)
    expect(v.errors.some((e) => e.includes('duplicate dataset id'))).toBe(true)
  })

  it('rejects a non-builtin kind', () => {
    const bad = structuredClone(entry('common-voice')) as unknown as {
      kind: string
      id: string
    }
    bad.kind = 'generated'
    const v = validateDatasetCatalog({
      schemaVersion: 1,
      datasets: [bad as unknown as DatasetCatalogEntry],
    })
    expect(v.ok).toBe(false)
    expect(v.errors.some((e) => e.includes('kind must be "builtin"'))).toBe(true)
  })

  it('rejects a missing materialize descriptor', () => {
    const { materialize: _drop, ...rest } = entry('common-voice')
    const v = validateDatasetCatalog({
      schemaVersion: 1,
      datasets: [rest as unknown as DatasetCatalogEntry],
    })
    expect(v.ok).toBe(false)
    expect(v.errors.some((e) => e.includes('materialize descriptor is required'))).toBe(true)
  })

  it('rejects a canonical-zip entry without a url', () => {
    const bad = structuredClone(entry('speech-commands-v2'))
    bad.materialize = { type: 'canonical-zip', url: '' }
    const v = validateDatasetCatalog({ schemaVersion: 1, datasets: [bad] })
    expect(v.ok).toBe(false)
    expect(v.errors.some((e) => e.includes('requires a non-empty url'))).toBe(true)
  })

  it('rejects an empty catalog', () => {
    const v = validateDatasetCatalog({ schemaVersion: 1, datasets: [] })
    expect(v.ok).toBe(false)
  })
})
