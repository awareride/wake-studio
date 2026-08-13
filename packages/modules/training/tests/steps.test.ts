/**
 * L1 tests — training wizard step machine (issue #105).
 *
 * Covers step ordering, navigation rules (manual Next/Back), and the Ready
 * step being terminal (Start lives there) — pure logic, no UI.
 */

import { describe, it, expect } from 'vitest'
import {
  STEP_ORDER,
  STEP_DEFS,
  jobPhase,
  canAdvance,
  canGoBack,
  nextStepId,
  advanceStep,
} from '../core/steps'

describe('wizard steps', () => {
  it('has exactly the planned four steps in order', () => {
    expect(STEP_ORDER).toEqual(['model', 'config', 'method', 'ready'])
  })

  it('defines every step with label, summary and inline guide lines', () => {
    for (const def of STEP_DEFS) {
      expect(STEP_ORDER).toContain(def.id)
      expect(def.label.length).toBeGreaterThan(0)
      expect(def.summary.length).toBeGreaterThan(0)
      expect(def.help.length).toBeGreaterThan(0)
    }
  })
})

describe('jobPhase normalization', () => {
  it('maps training statuses to phases', () => {
    expect(jobPhase('succeeded')).toBe('succeeded')
    expect(jobPhase('failed')).toBe('failed')
    expect(jobPhase('canceled')).toBe('canceled')
    expect(jobPhase('queued')).toBe('running')
    expect(jobPhase('running')).toBe('running')
  })

  it('treats unknown/absent statuses as idle', () => {
    expect(jobPhase(undefined)).toBe('idle')
    expect(jobPhase(null)).toBe('idle')
    expect(jobPhase('weird')).toBe('idle')
    expect(jobPhase('')).toBe('idle')
  })
})

describe('canAdvance', () => {
  it('allows Next on the first three steps', () => {
    expect(canAdvance('model')).toBe(true)
    expect(canAdvance('config')).toBe(true)
    expect(canAdvance('method')).toBe(true)
  })

  it('does not allow Next on Ready (Start lives there)', () => {
    expect(canAdvance('ready')).toBe(false)
  })
})

describe('canGoBack', () => {
  it('allows Back everywhere except the first step', () => {
    expect(canGoBack('model')).toBe(false)
    expect(canGoBack('config')).toBe(true)
    expect(canGoBack('method')).toBe(true)
    expect(canGoBack('ready')).toBe(true)
  })
})

describe('nextStepId / advanceStep', () => {
  it('walks the ordered steps and stops at Ready', () => {
    expect(nextStepId('model')).toBe('config')
    expect(nextStepId('config')).toBe('method')
    expect(nextStepId('method')).toBe('ready')
    expect(nextStepId('ready')).toBeUndefined()
    expect(advanceStep('model')).toBe('config')
    expect(advanceStep('method')).toBe('ready')
    expect(advanceStep('ready')).toBeUndefined()
  })
})