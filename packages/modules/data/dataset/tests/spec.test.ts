import { describe, it, expect } from 'vitest'
import {
  validateDatasetManifest,
  DATASET_MANIFEST_SCHEMA_VERSION,
  CANONICAL_ENCODING,
  type DatasetManifest,
} from '../core/spec'

/** A minimal but valid dataset.json for tests (docs/modules/data-sources.md §4.2). */
function validManifest(): DatasetManifest {
  return {
    schemaVersion: DATASET_MANIFEST_SCHEMA_VERSION,
    id: 'ds-1',
    name: 'wake-words-zh-en',
    version: 1,
    kind: 'generated',
    role: 'mixed',
    audio: { sampleRate: 16000, channels: 1, encoding: CANONICAL_ENCODING, clips: 4, durationSec: 12 },
    labels: [
      { name: 'hey_studio', role: 'positive', language: 'en-US', source: 'synthetic', voices: ['en-US-1'] },
      { name: 'hello', role: 'unknown', language: 'en-US' },
      { name: 'noise', role: 'noise' },
    ],
    provenance: [{ name: 'edge-tts synthetic speech', license: 'user-owned (synthetic TTS)', commercialUse: true }],
    recipe: { engine: 'edge-tts', phrases: ['hey studio'], languages: ['en-US'], seed: 0 },
  }
}

describe('dataset.json manifest contract (ADR-044 §4.2, task #203)', () => {
  it('accepts a well-formed manifest', () => {
    const r = validateDatasetManifest(validManifest())
    expect(r.ok).toBe(true)
    expect(r.errors).toEqual([])
  })

  it('rejects a manifest with a wrong schemaVersion', () => {
    const m = { ...validManifest(), schemaVersion: 999 }
    const r = validateDatasetManifest(m)
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toContain('schemaVersion')
  })

  it('rejects a manifest missing labels', () => {
    const m = { ...validManifest(), labels: [] }
    const r = validateDatasetManifest(m)
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toContain('labels')
  })

  it('rejects a label with an invalid semantic role', () => {
    const m = {
      ...validManifest(),
      labels: [{ name: 'hey_studio', role: 'wanted' }],
    }
    const r = validateDatasetManifest(m)
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toContain('role')
  })

  it('rejects duplicate label names', () => {
    const m = {
      ...validManifest(),
      labels: [
        { name: 'hey_studio', role: 'positive' },
        { name: 'hey_studio', role: 'unknown' },
      ],
    }
    const r = validateDatasetManifest(m)
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toContain('duplicates')
  })

  it('rejects a non-canonical audio encoding (derived formats are not stored)', () => {
    const m = { ...validManifest(), audio: { ...validManifest().audio, encoding: 'mp3' } }
    const r = validateDatasetManifest(m)
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toContain('encoding')
  })

  it('rejects provenance without a commercialUse boolean (export-gate input, #210)', () => {
    const m = {
      ...validManifest(),
      provenance: [{ name: 'x', license: 'CC0' }],
    }
    const r = validateDatasetManifest(m)
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toContain('commercialUse')
  })

  it('rejects version < 1', () => {
    const m = { ...validManifest(), version: 0 }
    const r = validateDatasetManifest(m)
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toContain('version')
  })

  it('rejects a non-object input', () => {
    expect(validateDatasetManifest(null).ok).toBe(false)
    expect(validateDatasetManifest('nope').ok).toBe(false)
  })
})
