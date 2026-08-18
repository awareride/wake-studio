/**
 * Train panel spec builder (issue #105).
 *
 * Builds a renderable panel spec from a trainable module's OWN declarations
 * (its spec.train.params + meta) — the wizard's Configure step renders this
 * through the generated panel, so each module provides its own train config
 * and nothing is hard-coded in the training module. Pure + L1-testable.
 */

import type { ModuleParam, ModuleSpec } from '@wake-studio/contracts'

/** The module-owned train declarations the wizard renders (subset of the
 *  generated train-modules.json catalog). */
export interface TrainableModuleLike {
  id: string
  name: string
  category: string
  license: string
  /** The module's own train params (spec.train.params). */
  params?: ModuleParam[]
  /** Selectable output formats (spec.train.formats, ADR-039 §4.6). */
  formats?: { default: string[]; options: string[] }
  /** Selectable quantization schemes (spec.train.quantization, ADR-039 §4.6). */
  quantization?: { default?: string; options: string[] }
}

export type TrainPanelSpec = Pick<
  ModuleSpec,
  'meta' | 'params' | 'actions' | 'status' | 'train'
>

/**
 * A panel spec whose params come from the module's spec.train.params. The
 * generated panel (module-kit renderPanel) renders only meta + params here
 * (no actions/status), so the wizard shows exactly the module's train knobs.
 */
export function trainPanelSpec(module: TrainableModuleLike): TrainPanelSpec {
  const params = [...(module.params ?? [])]

  // ADR-039 §4.6: formats + quantization are capability-labeled selectors
  // declared in spec.train — inject them as spec-driven params so the wizard
  // renders them without any hard-coded format UI here.
  if (module.formats?.options?.length) {
    params.push({
      id: 'formats',
      label: 'Output format(s)',
      group: 'primary',
      type: 'multiselect',
      default: (module.formats.default ?? []).join(','),
      options: module.formats.options,
      description: 'Target model format(s) to derive from the canonical artifact; pick several to zip them all (ADR-039 §4.6).',
    })
  }
  if (module.quantization?.options?.length) {
    params.push({
      id: 'quantization',
      label: 'Quantization',
      group: 'advanced',
      type: 'select',
      default: module.quantization.default ?? module.quantization.options[0],
      options: module.quantization.options,
      description: 'Quantization scheme applied to the requested formats (ADR-039 §4.6).',
    })
  }

  return {
    meta: {
      id: module.id,
      name: module.name,
      category: module.category as ModuleSpec['meta']['category'],
      version: '0.1.0',
      maturity: 'pilot',
      owner: 'WakeStudio team',
      license: module.license,
      status: 'accepted',
    },
    params,
    actions: [],
    status: [],
    // Declared so the spec stays type-valid; renderPanel only reads
    // spec.train.notebookLocal (and never with sections=['params']).
    train: { params, invocation: [], outputs: {} },
  }
}