/**
 * Few-Shot module - L1 unit tests for the parameter descriptors (ADR-026).
 *
 * Epic #53 P1 added the missing `vadThreshold` / `hopMs` descriptors so every
 * FewShotConfig field is editable from the config panel. This pins that every
 * config field has a descriptor (no more dead controls).
 */

import { describe, it, expect } from 'vitest'
import { DEFAULT_CONFIG, describeParameters } from '../core/defaults'

describe('parameter descriptors (epic #53 P1)', () => {
  it('covers every FewShotConfig field', () => {
    const ids = describeParameters().map((p) => p.id)
    for (const key of Object.keys(DEFAULT_CONFIG)) {
      expect(ids).toContain(key)
    }
  })

  it('includes the epic #53 fields that were previously dead', () => {
    const ids = describeParameters().map((p) => p.id)
    expect(ids).toContain('windowMs')
    expect(ids).toContain('useNegativePrototype')
    expect(ids).toContain('vadThreshold')
    expect(ids).toContain('hopMs')
  })

  it('has bounded numeric descriptors for the new fields', () => {
    const byId = new Map(describeParameters().map((p) => [p.id, p]))
    const vad = byId.get('vadThreshold')
    expect(vad?.min).toBeGreaterThanOrEqual(0)
    expect(vad?.max).toBeLessThanOrEqual(1)
    const hop = byId.get('hopMs')
    expect(hop?.min).toBeGreaterThan(0)
  })
})
