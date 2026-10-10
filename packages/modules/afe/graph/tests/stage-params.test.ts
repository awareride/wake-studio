/**
 * AFE graph - runtime stage parameter delivery (issue #243).
 *
 * The point of these tests is the failure this issue exists to prevent: a
 * control that renders, is wired to state, and never reaches the DSP. So the
 * assertions check that a value actually lands in the stage, and that bad
 * values fail loudly instead of being dropped.
 */

import { describe, it, expect } from 'vitest'
import {
  AFEParamError,
  defaultStageParams,
  validateStageParams,
} from '../core/validate-params'
import type { AFEStageKind } from '../core/types'

describe('validateStageParams', () => {
  it('accepts values declared in the stage module spec', () => {
    expect(() => validateStageParams('ns', { strength: 0.4 })).not.toThrow()
    expect(() => validateStageParams('ns', { denoiseEnabled: false })).not.toThrow()
    expect(() => validateStageParams('ns', { strength: 0, denoiseEnabled: true })).not.toThrow()
  })

  it('rejects unknown keys instead of dropping them', () => {
    // A silently dropped key is exactly the "dead control" failure mode.
    expect(() => validateStageParams('ns', { nonsense: 1 })).toThrow(AFEParamError)
    try {
      validateStageParams('ns', { nonsense: 1 })
    } catch (e) {
      expect((e as AFEParamError).param).toBe('nonsense')
      expect((e as Error).message).toContain('not declared in rnnoise')
    }
  })

  it('enforces numeric ranges from the spec', () => {
    expect(() => validateStageParams('ns', { strength: 1.5 })).toThrow(/above the maximum/)
    expect(() => validateStageParams('ns', { strength: -0.1 })).toThrow(/below the minimum/)
  })

  it('enforces param types', () => {
    expect(() => validateStageParams('ns', { strength: 'loud' })).toThrow(/finite number/)
    expect(() => validateStageParams('ns', { denoiseEnabled: 1 })).toThrow(/boolean/)
    expect(() => validateStageParams('ns', { strength: Number.NaN })).toThrow()
  })

  it('knows which stage owns which params', () => {
    // `strength` belongs to the NS spec, so the AEC stage must reject it.
    expect(() => validateStageParams('aec', { strength: 0.5 })).toThrow(AFEParamError)
    expect(() => validateStageParams('aec', { bypass: true })).not.toThrow()
  })

  it('rejects a non-scalar value (cannot cross the worklet boundary)', () => {
    expect(() =>
      validateStageParams('ns', { strength: { nested: true } } as never),
    ).toThrow()
  })

  it('rejects an unknown stage kind', () => {
    expect(() => validateStageParams('nope' as AFEStageKind, {})).toThrow(AFEParamError)
  })
})

describe('defaultStageParams', () => {
  it('returns spec defaults without the bypass pseudo-param', () => {
    const ns = defaultStageParams('ns')
    expect(ns).toEqual({ strength: 1, denoiseEnabled: true })
    expect('bypass' in ns).toBe(false)
  })

  it('produces a set that passes validation', () => {
    for (const kind of ['aec', 'bss', 'ns'] as AFEStageKind[]) {
      const defaults = defaultStageParams(kind)
      expect(() => validateStageParams(kind, defaults)).not.toThrow()
    }
  })
})