/**
 * L1 tests — notebook personalization (issue #105).
 *
 * The wizard's params must reach the downloaded notebook: the template's
 * Step-0 cell reads `os.environ.get("WAKE_N_SAMPLES", "1000")` — after
 * personalization the default is the user's value.
 */

import { describe, it, expect } from 'vitest'
import { personalizeNotebook, personalizedParamIds } from '../core/notebook'

const PARAMS = [
  { id: 'wakePhrase', env: 'WAKE_PHRASE', default: 'hey studio' },
  { id: 'nSamples', env: 'WAKE_N_SAMPLES', default: 1000 },
  { id: 'steps', env: 'WAKE_STEPS', default: 10000 },
  { id: 'augment', env: 'WAKE_AUGMENT', default: true },
] as const

function template() {
  return {
    cells: [
      { id: 'intro', cell_type: 'markdown', source: '# hi' },
      {
        id: 'params',
        cell_type: 'code',
        source: [
          'N_SAMPLES = int(os.environ.get("WAKE_N_SAMPLES", "1000"))',
          'STEPS = int(os.environ.get("WAKE_STEPS", "10000"))',
          'WAKE_PHRASE = os.environ.get("WAKE_PHRASE", "hey studio")',
          'AUGMENT = os.environ.get("WAKE_AUGMENT", "true").lower() in ("1","true","yes")',
        ],
      },
    ],
  }
}

describe('personalizeNotebook', () => {
  it('replaces the env defaults in the params cell with the user values', () => {
    const out = personalizeNotebook(template(), PARAMS, {
      wakePhrase: 'hey jarvis',
      nSamples: '9999',
      steps: '50000',
      augment: 'false',
    }) as { cells: Array<{ source: string[] }> }
    const src = out.cells[1].source.join('\n')
    expect(src).toContain('os.environ.get("WAKE_N_SAMPLES", "9999")')
    expect(src).toContain('os.environ.get("WAKE_STEPS", "50000")')
    expect(src).toContain('os.environ.get("WAKE_PHRASE", "hey jarvis")')
    expect(src).toContain('os.environ.get("WAKE_AUGMENT", "false")')
  })

  it('leaves unconfigured params at their template defaults', () => {
    const out = personalizeNotebook(template(), PARAMS, { wakePhrase: 'hey jarvis' })
    const src = (out as { cells: Array<{ source: string[] }> }).cells[1].source.join('\n')
    expect(src).toContain('os.environ.get("WAKE_N_SAMPLES", "1000")')
    expect(src).toContain('os.environ.get("WAKE_PHRASE", "hey jarvis")')
  })

  it('returns the same object when nothing applies', () => {
    const nb = template()
    expect(personalizeNotebook(nb, PARAMS, {})).toBe(nb)
    expect(personalizeNotebook(nb, [], { wakePhrase: 'x' })).toBe(nb)
  })

  it('does not mutate the input notebook', () => {
    const nb = template()
    personalizeNotebook(nb, PARAMS, { nSamples: '9999' })
    const src = (nb.cells as Array<{ source: string[] }>)[1].source.join('\n')
    expect(src).toContain('os.environ.get("WAKE_N_SAMPLES", "1000")')
  })
})

describe('personalizedParamIds', () => {
  it('lists the params that will be baked in', () => {
    expect(personalizedParamIds(PARAMS, { nSamples: '9999', steps: '5' })).toEqual([
      'nSamples',
      'steps',
    ])
    expect(personalizedParamIds(PARAMS, {})).toEqual([])
  })
})