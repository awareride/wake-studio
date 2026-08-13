/**
 * L1 tests — training console stepper state machine (issue #105).
 *
 * Covers step ordering, manual navigation rules, and the auto-advance to
 * Review on job success (plan T-7) — pure logic, no UI.
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

describe('stepper steps', () => {
  it('has exactly the planned four steps in order', () => {
    expect(STEP_ORDER).toEqual(['configure', 'connect', 'run', 'review'])
  })

  it('defines every step with label, summary and help lines', () => {
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
  it('allows manual Next on Configure and Connect regardless of phase', () => {
    expect(canAdvance('configure', 'idle')).toBe(true)
    expect(canAdvance('connect', 'idle')).toBe(true)
    expect(canAdvance('configure', 'running')).toBe(true)
  })

  it('allows leaving Run only automatically on job success', () => {
    expect(canAdvance('run', 'idle')).toBe(false)
    expect(canAdvance('run', 'running')).toBe(false)
    expect(canAdvance('run', 'failed')).toBe(false)
    expect(canAdvance('run', 'succeeded')).toBe(true)
  })

  it('never advances past the terminal Review step', () => {
    expect(canAdvance('review', 'succeeded')).toBe(false)
  })
})

describe('canGoBack', () => {
  it('allows Back everywhere except the first step', () => {
    expect(canGoBack('configure')).toBe(false)
    expect(canGoBack('connect')).toBe(true)
    expect(canGoBack('run')).toBe(true)
    expect(canGoBack('review')).toBe(true)
  })
})

describe('nextStepId', () => {
  it('walks the ordered steps and stops at Review', () => {
    expect(nextStepId('configure')).toBe('connect')
    expect(nextStepId('connect')).toBe('run')
    expect(nextStepId('run')).toBe('review')
    expect(nextStepId('review')).toBeUndefined()
  })
})

describe('advanceStep (manual next + auto-advance)', () => {
  it('auto-advances Run → Review on job success', () => {
    expect(advanceStep('run', 'succeeded')).toBe('review')
  })

  it('keeps Run in place while running/failed', () => {
    expect(advanceStep('run', 'running')).toBeUndefined()
    expect(advanceStep('run', 'failed')).toBeUndefined()
  })

  it('advances Configure/Connect manually', () => {
    expect(advanceStep('configure', 'idle')).toBe('connect')
    expect(advanceStep('connect', 'running')).toBe('run')
  })

  it('never leaves Review', () => {
    expect(advanceStep('review', 'succeeded')).toBeUndefined()
  })
})