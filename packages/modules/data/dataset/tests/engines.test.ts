import { describe, it, expect } from 'vitest'
import {
  validateEngineCatalog,
  engineById,
  isBrowserCapable,
  type DatasetEngineCatalog,
  type TTSEngineDescriptor,
} from '../core/engines'

/** A catalog shaped like the generated dataset-engines.json. */
function catalog(...engines: TTSEngineDescriptor[]): DatasetEngineCatalog {
  return { engines }
}

const EDGE: TTSEngineDescriptor = {
  id: 'edge-tts',
  name: 'Microsoft Edge TTS (classic)',
  kind: 'classic-tts',
  runtime: ['backend'],
  params: [{ id: 'languages', type: 'string' }],
  provenanceTemplate: { name: 'x', license: 'user-owned', commercialUse: true },
}

const MIMO: TTSEngineDescriptor = {
  id: 'mimo-tts',
  name: 'MiMo TTS (online HTTP)',
  kind: 'online-http-tts',
  runtime: ['browser', 'backend'],
  defaultModel: 'mimo-v2.5-tts',
  params: [{ id: 'apiKey', type: 'secret' }],
  provenanceTemplate: { name: 'x', license: 'user-owned', commercialUse: true },
}

describe('TTS engine catalog contract (ADR-044 §5, task #205)', () => {
  it('validates a well-formed catalog', () => {
    const r = validateEngineCatalog(catalog(EDGE, MIMO))
    expect(r.ok).toBe(true)
    expect(r.errors).toEqual([])
  })

  it('resolves engines by id', () => {
    const c = catalog(EDGE, MIMO)
    expect(engineById(c, 'edge-tts')?.kind).toBe('classic-tts')
    expect(engineById(c, 'mimo-tts')?.kind).toBe('online-http-tts')
    expect(engineById(c, 'nope')).toBeUndefined()
  })

  it('marks only online HTTP engines as browser-capable', () => {
    expect(isBrowserCapable(MIMO)).toBe(true)
    expect(isBrowserCapable(EDGE)).toBe(false)
  })

  it('rejects a duplicate id', () => {
    const r = validateEngineCatalog(catalog(EDGE, EDGE))
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toContain('duplicate')
  })

  it('rejects an invalid kind', () => {
    const r = validateEngineCatalog(catalog({ ...EDGE, kind: 'spooky' as never }))
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toContain('kind')
  })
})
