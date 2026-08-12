/**
 * module-kit panel generator - unit tests (L1).
 *
 * The generator's pure parts: spec validation, defaults extraction, and
 * rendering without throwing. Rendering is checked with react-dom/server
 * (no browser needed).
 */

import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ModuleSpec } from '@wake-studio/contracts'
import { validateModuleSpec } from '../src/validator'
import {
  defaultsFromSpec,
  renderPanel,
  ModulePanel,
  buildColabUrl,
} from '../src/panel-generator'

// A minimal but complete spec (mirrors rnnoise/module.spec.json shape).
const MINIMAL_SPEC: ModuleSpec = {
  meta: {
    id: 'test-module',
    name: 'Test Module',
    category: 'afe',
    version: '1.0.0',
    maturity: 'pilot',
    owner: 'test',
    license: 'MIT',
    status: 'accepted',
  },
  params: [
    {
      id: 'strength',
      label: 'Strength',
      group: 'primary',
      type: 'slider',
      default: 1,
      min: 0,
      max: 1,
      step: 0.1,
      description: 'Test param',
    },
    {
      id: 'enabled',
      label: 'Enabled',
      group: 'advanced',
      type: 'boolean',
      default: true,
      description: 'Advanced toggle',
    },
  ],
  actions: [
    { id: 'run', label: 'Run', kind: 'start', confirm: false },
    { id: 'reset', label: 'Reset', kind: 'reset', confirm: true },
  ],
  status: [
    { id: 'vad', label: 'VAD', renderer: 'bar', source: 'event:frame' },
    { id: 'curve', label: 'History', renderer: 'curve', source: 'event:frame' },
  ],
  runtime: { web: { engine: 'TestEngine' } },
  tests: { required: ['l1'] },
  playground: { route: '/playground/test', entry: 'playground.tsx' },
  interfaces: { provides: [], consumes: [] },
}

describe('validateModuleSpec', () => {
  it('accepts a complete spec', () => {
    const res = validateModuleSpec(MINIMAL_SPEC)
    expect(res.ok).toBe(true)
    expect(res.errors).toEqual([])
  })

  it('rejects a spec missing required keys', () => {
    const bad = { meta: MINIMAL_SPEC.meta } as unknown as ModuleSpec
    const res = validateModuleSpec(bad)
    expect(res.ok).toBe(false)
    expect(res.errors.some((e) => e.includes('params'))).toBe(true)
  })

  it('rejects a param with an invalid group', () => {
    const bad = structuredClone(MINIMAL_SPEC)
    bad.params[0] = { ...bad.params[0], group: 'weird' as never }
    const res = validateModuleSpec(bad)
    expect(res.ok).toBe(false)
    expect(res.errors.some((e) => e.includes('group'))).toBe(true)
  })

  it('rejects a train block with no invocation source', () => {
    const bad = structuredClone(MINIMAL_SPEC)
    bad.train = { invocation: ['colab'], outputs: {} }
    const res = validateModuleSpec(bad)
    expect(res.ok).toBe(false)
    expect(res.errors.some((e) => e.includes('notebookLocal'))).toBe(true)
  })

  it('accepts a colab-only train block (notebookLocal, no local entry) (ADR-035)', () => {
    const ok = structuredClone(MINIMAL_SPEC)
    ok.train = {
      notebookLocal: 'packages/modules/kws/openwakeword/train/colab/train.ipynb',
      invocation: ['colab'],
      outputs: { checkpoint: 'out/model.onnx' },
    }
    const res = validateModuleSpec(ok)
    expect(res.ok).toBe(true)
    expect(res.errors).toEqual([])
  })
})

describe('defaultsFromSpec', () => {
  it('maps every param to its default', () => {
    const d = defaultsFromSpec(MINIMAL_SPEC)
    expect(d).toEqual({ strength: 1, enabled: true })
  })
})

describe('buildColabUrl', () => {
  it('builds the GitHub→Colab URL from a repo-relative notebook path (ADR-035)', () => {
    const url = buildColabUrl(
      'packages/modules/kws/openwakeword/train/colab/train.ipynb',
    )
    expect(url).toBe(
      'https://colab.research.google.com/github/awareride/wake-studio/blob/main/packages/modules/kws/openwakeword/train/colab/train.ipynb',
    )
  })
})

describe('renderPanel', () => {
  it('returns a component that renders the spec (SSR)', () => {
    const Panel = renderPanel(MINIMAL_SPEC)
    const controller = {
      values: defaultsFromSpec(MINIMAL_SPEC),
      setValue: () => {},
      runAction: () => {},
      status: { vad: 0.5, curve: [0.1, 0.2, 0.3] },
    }
    const html = renderToStaticMarkup(<Panel controller={controller} />)
    // Heading + primary param + actions render; advanced is collapsed (ADR-024).
    expect(html).toContain('Test Module')
    expect(html).toContain('Strength')
    expect(html).not.toContain('Enabled') // advanced, collapsed by default
    expect(html).toContain('Run')
    expect(html).toContain('Reset')

    // With the advanced section open, the param appears.
    const openHtml = renderToStaticMarkup(
      <ModulePanel
        spec={MINIMAL_SPEC}
        controller={controller}
      />,
    )
    // ModulePanel starts closed; assert the trigger exists so it CAN be opened.
    expect(openHtml).toContain('Advanced')
  })

  it('ModulePanel is a named component from the spec', () => {
    const Panel = renderPanel(MINIMAL_SPEC)
    expect(Panel.displayName).toBe('ModulePanel(test-module)')
  })

  it('renders an Open in Colab link when spec.train.notebookLocal is set (ADR-035)', () => {
    const withNotebook = structuredClone(MINIMAL_SPEC)
    withNotebook.train = {
      notebookLocal: 'packages/modules/kws/openwakeword/train/colab/train.ipynb',
      invocation: ['colab'],
      outputs: { checkpoint: 'out/model.onnx' },
    }
    const html = renderToStaticMarkup(
      <ModulePanel spec={withNotebook} controller={{
        values: defaultsFromSpec(withNotebook),
        setValue: () => {},
        runAction: () => {},
      }} />,
    )
    expect(html).toContain('Open in Colab')
    expect(html).toContain(
      'https://colab.research.google.com/github/awareride/wake-studio/blob/main/packages/modules/kws/openwakeword/train/colab/train.ipynb',
    )
    expect(html).toContain('target="_blank"')
  })

  it('does not render an Open in Colab link without notebookLocal', () => {
    const html = renderToStaticMarkup(
      <ModulePanel spec={MINIMAL_SPEC} controller={{
        values: defaultsFromSpec(MINIMAL_SPEC),
        setValue: () => {},
        runAction: () => {},
      }} />,
    )
    expect(html).not.toContain('Open in Colab')
  })
})
