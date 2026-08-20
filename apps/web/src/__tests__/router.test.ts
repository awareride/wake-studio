/**
 * Router hash helpers — New-train wizard step encoding (issue #136).
 */

import { describe, expect, it } from 'vitest'
import {
  BACKENDS_HASH_PREFIX,
  TRAIN_NEW_HASH_PREFIX,
  TRAIN_REVIEW_HASH_PREFIX,
  backendsSubFromHash,
  routeToHash,
  trainNewReviewFromHash,
  trainNewStepFromHash,
  trainReviewJobFromHash,
} from '../router'

describe('trainNewStepFromHash', () => {
  it('returns the wizard step for `#/training/new/<step>`', () => {
    expect(trainNewStepFromHash('#/training/new/config')).toBe('config')
    expect(trainNewStepFromHash('#/training/new/method')).toBe('method')
    expect(trainNewStepFromHash('#/training/new/ready')).toBe('ready')
  })

  it('returns undefined for the wizard-open hash (its first step)', () => {
    expect(trainNewStepFromHash('#/training/new')).toBeUndefined()
    expect(trainNewStepFromHash('#/training/new/')).toBeUndefined()
  })

  it('returns undefined for non-wizard hashes', () => {
    expect(trainNewStepFromHash('#/training')).toBeUndefined()
    expect(trainNewStepFromHash('#/workspace')).toBeUndefined()
    expect(trainNewStepFromHash('#/settings/modules/plixkws')).toBeUndefined()
    expect(trainNewStepFromHash('')).toBeUndefined()
  })

  it('tolerates hashes without the leading #', () => {
    expect(trainNewStepFromHash('/training/new/ready')).toBe('ready')
  })

  it('exposes the wizard hash prefix for building entries', () => {
    expect(TRAIN_NEW_HASH_PREFIX).toBe('/training/new')
    expect(`#${TRAIN_NEW_HASH_PREFIX}/config`).toBe('#/training/new/config')
  })
})

describe('trainNewReviewFromHash', () => {
  it('detects the wizard review sub-panel', () => {
    expect(trainNewReviewFromHash('#/training/new/ready/review')).toBe(true)
    expect(trainNewReviewFromHash('#/training/new/review')).toBe(true)
  })

  it('is false for plain step and non-wizard hashes', () => {
    expect(trainNewReviewFromHash('#/training/new/ready')).toBe(false)
    expect(trainNewReviewFromHash('#/training/new')).toBe(false)
    expect(trainNewReviewFromHash('#/training/review/train-1')).toBe(false)
    expect(trainNewReviewFromHash('#/workspace')).toBe(false)
  })
})

describe('trainReviewJobFromHash', () => {
  it('extracts the job id from `#/training/review/<jobId>`', () => {
    expect(trainReviewJobFromHash('#/training/review/train-123')).toBe('train-123')
    expect(trainReviewJobFromHash('#/training/review/train-123/extra')).toBe('train-123')
  })

  it('returns undefined for non-review hashes', () => {
    expect(trainReviewJobFromHash('#/training')).toBeUndefined()
    expect(trainReviewJobFromHash('#/training/new/ready/review')).toBeUndefined()
    expect(trainReviewJobFromHash('#/backends')).toBeUndefined()
    expect(TRAIN_REVIEW_HASH_PREFIX).toBe('/training/review')
  })
})

describe('datasets route', () => {
  it('maps the datasets console route to `#/datasets` and stays distinct (ADR-044 §8, #208)', () => {
    expect(routeToHash('datasets')).toBe('/datasets')
    // The hash parser lives behind window.location; the static mapping is the
    // shell's single source of truth, so assert the pair is consistent and
    // distinct from its neighbours (Training / Backends).
    expect(routeToHash('datasets')).not.toBe(routeToHash('training'))
    expect(routeToHash('datasets')).not.toBe(routeToHash('backends'))
  })
})

describe('backendsSubFromHash', () => {
  it('extracts the Backends full-panel sub-route', () => {
    expect(backendsSubFromHash('#/backends/new')).toBe('new')
    expect(backendsSubFromHash('#/backends/colab')).toBe('colab')
    expect(backendsSubFromHash('#/backends/colab/preview')).toBe('colab/preview')
  })

  it('returns undefined for the plain Backends list and other hashes', () => {
    expect(backendsSubFromHash('#/backends')).toBeUndefined()
    expect(backendsSubFromHash('#/training')).toBeUndefined()
    expect(backendsSubFromHash('')).toBeUndefined()
    expect(BACKENDS_HASH_PREFIX).toBe('/backends')
  })
})
