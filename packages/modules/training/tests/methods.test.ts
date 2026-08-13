/**
 * L1 tests — training methods (issue #105).
 *
 * spec.train.invocation → method cards the wizard's "Choose train method"
 * step renders, plus the backend mapping.
 */

import { describe, it, expect } from 'vitest'
import {
  TRAIN_METHODS,
  TRAIN_METHOD_ORDER,
  methodsFor,
  supportsMethod,
  backendForMethod,
} from '../core/methods'

describe('TRAIN_METHODS', () => {
  it('defines the three methods with labels and blurbs', () => {
    expect(TRAIN_METHOD_ORDER).toEqual(['colab', 'subprocess', 'ci'])
    for (const id of TRAIN_METHOD_ORDER) {
      expect(TRAIN_METHODS[id].label.length).toBeGreaterThan(0)
      expect(TRAIN_METHODS[id].blurb.length).toBeGreaterThan(0)
    }
  })

  it('gives Colab and Self-hosted a url config, CI none', () => {
    expect(TRAIN_METHODS.colab.urlConfig?.key).toBe('tunnelUrl')
    expect(TRAIN_METHODS.subprocess.urlConfig?.key).toBe('endpointUrl')
    expect(TRAIN_METHODS.ci.urlConfig).toBeUndefined()
  })
})

describe('methodsFor', () => {
  it('maps a module invocation to ordered method cards', () => {
    const methods = methodsFor(['subprocess', 'ci', 'colab'])
    expect(methods.map((m) => m.id)).toEqual(['colab', 'subprocess', 'ci'])
  })

  it('respects the module\u2019s declared subset', () => {
    expect(methodsFor(['colab']).map((m) => m.id)).toEqual(['colab'])
    expect(methodsFor(['ci']).map((m) => m.id)).toEqual(['ci'])
  })

  it('falls back to Colab when invocation is missing/empty', () => {
    expect(methodsFor(undefined).map((m) => m.id)).toEqual(['colab'])
    expect(methodsFor([]).map((m) => m.id)).toEqual(['colab'])
  })

  it('ignores unknown invocation ids', () => {
    expect(methodsFor(['colab', 'bogus']).map((m) => m.id)).toEqual(['colab'])
  })
})

describe('supportsMethod', () => {
  it('checks membership in the declared invocation', () => {
    expect(supportsMethod(['colab'], 'colab')).toBe(true)
    expect(supportsMethod(['colab'], 'subprocess')).toBe(false)
    expect(supportsMethod(undefined, 'colab')).toBe(true)
  })
})

describe('backendForMethod', () => {
  it('maps Colab → colab and the rest → self-hosted (ADR-013 values)', () => {
    expect(backendForMethod('colab')).toBe('colab')
    expect(backendForMethod('subprocess')).toBe('self-hosted')
    expect(backendForMethod('ci')).toBe('self-hosted')
  })
})