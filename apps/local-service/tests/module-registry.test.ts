/**
 * local-service - module registry tests (L1).
 *
 * Verifies discovery over the real monorepo: the rnnoise pilot module is
 * found with its spec parsed and targets detected.
 */

import { describe, it, expect } from 'vitest'
import { discoverModules, findModule } from '../src/module-registry'

describe('module-registry', () => {
  it('discovers the rnnoise pilot module', () => {
    const modules = discoverModules()
    const rnnoise = modules.find((m) => m.id === 'rnnoise')
    expect(rnnoise).toBeDefined()
    expect(rnnoise?.category).toBe('afe')
    expect(rnnoise?.spec.meta.name).toBe('RNNoise Noise Suppression')
    expect(rnnoise?.hasNodeTarget).toBe(true)
    expect(rnnoise?.hasTrainTarget).toBe(true)
    expect(rnnoise?.hasDeviceTarget).toBe(true) // device/ placeholder dir exists
  })

  it('sorts by category then id', () => {
    const modules = discoverModules()
    const keys = modules.map((m) => `${m.category}/${m.id}`)
    expect([...keys].sort()).toEqual(keys)
  })

  it('findModule resolves by id', () => {
    expect(findModule('rnnoise')?.spec.meta.version).toBe('1.0.0')
    expect(findModule('does-not-exist')).toBeUndefined()
  })
})
