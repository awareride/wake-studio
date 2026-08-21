/**
 * Datasets — executor decision (ADR-044 §8.1, #208).
 *
 * Pure + L1: the console picks the generation executor from (a) the engine's
 * declared `runtime` and (b) studio-backend connectivity. Assert every cell of
 * the §8.1 table.
 */

import { describe, expect, it } from 'vitest'
import { resolveExecutor } from '../executor'
import type { TTSEngineDescriptor } from '@wake-studio/module-dataset'

function engine(runtime: TTSEngineDescriptor['runtime']): TTSEngineDescriptor {
  return {
    id: 'test-tts',
    name: 'Test TTS',
    kind: 'online-http-tts',
    runtime,
    params: [],
    provenanceTemplate: { name: 'x', license: 'user-owned', commercialUse: true },
  }
}

describe('resolveExecutor', () => {
  it('prefers the backend executor when a studio-backend is connected', () => {
    const e = engine(['browser', 'backend'])
    const d = resolveExecutor(e, true)
    expect(d.executor).toBe('backend')
    expect(d.unavailable).toBeUndefined()
  })

  it('falls back to the browser executor for a browser-capable engine with no backend', () => {
    const e = engine(['browser', 'backend'])
    const d = resolveExecutor(e, false)
    expect(d.executor).toBe('browser')
  })

  it('blocks a backend-only engine when no backend is connected', () => {
    const e = engine(['backend'])
    const d = resolveExecutor(e, false)
    expect(d.executor).toBeNull()
    expect(d.unavailable).toMatch(/studio-backend/)
  })

  it('runs a backend-only engine on the backend when connected', () => {
    const e = engine(['backend'])
    expect(resolveExecutor(e, true).executor).toBe('backend')
  })

  it('always notes which executor is chosen', () => {
    expect(resolveExecutor(engine(['backend']), true).note).toMatch(/studio-backend/)
    expect(resolveExecutor(engine(['browser']), false).note).toMatch(/browser/)
  })
})
