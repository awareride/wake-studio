/**
 * Router hash helpers — New-train wizard step encoding (issue #136).
 */

import { describe, expect, it } from 'vitest'
import { TRAIN_NEW_HASH_PREFIX, trainNewStepFromHash } from '../router'

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
