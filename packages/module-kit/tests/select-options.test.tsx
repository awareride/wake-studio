/**
 * module-kit - select option normalization (regression tests).
 *
 * Bug: every spec-driven dropdown whose spec used the JSON schema's plain
 * `string[]` form rendered BLANK entries, because the mapper read `.label` off
 * a string. This affected afe-graph `topology`, kws-engine `executionProvider`,
 * training `target`/`backend` and kws-streaming `wantedWord`.
 *
 * The contract now documents BOTH shapes, so these tests pin both.
 */

import { describe, it, expect } from 'vitest'
import { normalizeSelectOptions } from '../src/ui/mapper'

describe('normalizeSelectOptions', () => {
  it('turns plain strings into {value,label} pairs (the schema form)', () => {
    expect(normalizeSelectOptions(['wasm', 'webgpu'])).toEqual([
      { value: 'wasm', label: 'wasm' },
      { value: 'webgpu', label: 'webgpu' },
    ])
  })

  it('never yields an empty label (the visible symptom of the bug)', () => {
    const opts = normalizeSelectOptions(['yes', 'no', 'up', 'down'])
    expect(opts).toHaveLength(4)
    for (const o of opts) {
      expect(o.label).toBeTruthy()
      expect(o.label).toBe(o.value)
    }
  })

  it('passes {value,label} pairs through unchanged', () => {
    expect(
      normalizeSelectOptions([
        { value: 'base', label: 'PLiX base (EfficientNet-v2-M)' },
        { value: 'small', label: 'PLiX small (TinyNet-E)' },
      ]),
    ).toEqual([
      { value: 'base', label: 'PLiX base (EfficientNet-v2-M)' },
      { value: 'small', label: 'PLiX small (TinyNet-E)' },
    ])
  })

  it('falls back to the value when an object omits its label', () => {
    expect(normalizeSelectOptions([{ value: 'onnx' }])).toEqual([
      { value: 'onnx', label: 'onnx' },
    ])
  })

  it('tolerates a mixed array', () => {
    expect(
      normalizeSelectOptions(['wasm', { value: 'webgpu', label: 'WebGPU' }]),
    ).toEqual([
      { value: 'wasm', label: 'wasm' },
      { value: 'webgpu', label: 'WebGPU' },
    ])
  })

  it('handles undefined / empty', () => {
    expect(normalizeSelectOptions(undefined)).toEqual([])
    expect(normalizeSelectOptions([])).toEqual([])
  })

  it('drops malformed entries instead of rendering blanks', () => {
    expect(
      normalizeSelectOptions([
        'ok',
        null as never,
        {} as never,
        123 as never,
      ]),
    ).toEqual([{ value: 'ok', label: 'ok' }])
  })
})
