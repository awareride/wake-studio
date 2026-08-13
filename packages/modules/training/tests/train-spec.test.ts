/**
 * L1 tests — train panel spec builder (issue #105).
 *
 * The wizard's Configure step renders a module's OWN train params
 * (spec.train.params) through the generated panel. This builder must map the
 * module's declarations into a renderable panel spec without any hard-coded
 * params in the training module.
 */

import { describe, it, expect } from 'vitest'
import { trainPanelSpec } from '../core/train-spec'

describe('trainPanelSpec', () => {
  it('builds a panel spec from the module\u2019s own train params', () => {
    const spec = trainPanelSpec({
      id: 'kws-openwakeword',
      name: 'OpenWakeWord KWS driver',
      category: 'kws',
      license: 'Apache-2.0',
      params: [
        {
          id: 'wakePhrase',
          label: 'Wake phrase',
          group: 'primary',
          type: 'string',
          default: 'hey studio',
          description: 'The wake phrase.',
        },
        {
          id: 'steps',
          label: 'Training steps',
          group: 'advanced',
          type: 'number',
          default: 10000,
          description: 'Steps.',
        },
      ],
    })
    expect(spec.meta.id).toBe('kws-openwakeword')
    expect(spec.meta.category).toBe('kws')
    expect(spec.params.map((p) => p.id)).toEqual(['wakePhrase', 'steps'])
    expect(spec.train?.params).toEqual(spec.params)
    expect(spec.actions).toEqual([])
    expect(spec.status).toEqual([])
  })

  it('yields an empty params form when the module declares none', () => {
    const spec = trainPanelSpec({
      id: 'rnnoise',
      name: 'RNNoise Noise Suppression',
      category: 'afe',
      license: 'BSD-3-Clause',
    })
    expect(spec.params).toEqual([])
    expect(spec.train?.params).toEqual([])
  })

  it('does not inherit params from the caller', () => {
    const a = trainPanelSpec({
      id: 'm1',
      name: 'One',
      category: 'kws',
      license: 'MIT',
      params: [
        { id: 'x', label: 'X', group: 'primary', type: 'boolean', default: true, description: 'X.' },
      ],
    })
    const b = trainPanelSpec({ id: 'm2', name: 'Two', category: 'kws', license: 'MIT' })
    expect(a.params.map((p) => p.id)).toEqual(['x'])
    expect(b.params).toEqual([])
  })
})