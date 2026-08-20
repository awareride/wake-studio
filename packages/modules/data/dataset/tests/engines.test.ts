import { describe, it, expect } from 'vitest'
import {
  DATASET_ENGINES,
  engineById,
  validateEngineCatalog,
  isBrowserCapable,
  TTS_ENGINE_KINDS,
} from '../core/engines'

describe('TTS engine descriptors (ADR-044 §5, task #205)', () => {
  it('ships the built-in engine catalog with valid descriptors', () => {
    const r = validateEngineCatalog(DATASET_ENGINES)
    expect(r.ok).toBe(true)
    expect(r.errors).toEqual([])
  })

  it('has unique ids and at least one engine per kind', () => {
    const ids = DATASET_ENGINES.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const kind of TTS_ENGINE_KINDS) {
      expect(DATASET_ENGINES.some((e) => e.kind === kind)).toBe(true)
    }
  })

  it('resolves engines by id', () => {
    expect(engineById('edge-tts')?.kind).toBe('classic-tts')
    expect(engineById('mimo-http')?.kind).toBe('online-http-tts')
    expect(engineById('qwen-llm-tts')?.kind).toBe('llm-tts')
    expect(engineById('nope')).toBeUndefined()
  })

  it('marks only online HTTP engines as browser-capable', () => {
    expect(isBrowserCapable(engineById('mimo-http')!)).toBe(true)
    expect(isBrowserCapable(engineById('edge-tts')!)).toBe(false)
    expect(isBrowserCapable(engineById('qwen-llm-tts')!)).toBe(false)
  })

  it('declares a provenance template (license-gate input, #210)', () => {
    for (const e of DATASET_ENGINES) {
      expect(typeof e.provenanceTemplate.name).toBe('string')
      expect(typeof e.provenanceTemplate.license).toBe('string')
      expect(typeof e.provenanceTemplate.commercialUse).toBe('boolean')
    }
  })

  it('rejects a duplicate id', () => {
    const dup = [DATASET_ENGINES[0], DATASET_ENGINES[0]]
    const r = validateEngineCatalog(dup)
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toContain('duplicate')
  })
})
