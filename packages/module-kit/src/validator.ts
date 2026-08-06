/**
 * Module spec validator (ADR-025).
 *
 * Pure function over `ModuleSpec` - used by the panel generator, the
 * studio-backend route registry, and CI to fail loudly on a malformed spec. */

import type { ModuleSpec, ModuleScorecard } from '@wake-studio/contracts'

export interface SpecValidationResult {
  ok: boolean
  errors: string[]
  warnings: string[]
}

const REQUIRED_TOP_LEVEL = [
  'meta',
  'params',
  'actions',
  'status',
  'runtime',
  'tests',
  'playground',
  'interfaces',
] as const

export function validateModuleSpec(raw: unknown): SpecValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  if (!raw || typeof raw !== 'object') {
    return { ok: false, errors: ['spec is not an object'], warnings }
  }
  const spec = raw as Partial<ModuleSpec>

  for (const key of REQUIRED_TOP_LEVEL) {
    if (!(key in spec)) errors.push(`missing top-level key: ${key}`)
  }

  if (spec.meta) {
    const meta = spec.meta
    if (!meta.id) errors.push('meta.id is required')
    if (!meta.name) errors.push('meta.name is required')
    if (!['afe', 'kws', 'few-shot', 'training', 'data', 'export', 'platform'].includes(meta.category))
      errors.push(`meta.category invalid: ${meta.category}`)
  }

  if (spec.params) {
    const ids = new Set<string>()
    for (const p of spec.params) {
      if (!p.id) errors.push('param without id')
      if (ids.has(p.id)) errors.push(`duplicate param id: ${p.id}`)
      ids.add(p.id)
      if (!['primary', 'advanced'].includes(p.group))
        errors.push(`param ${p.id}: group must be primary|advanced`)
    }
  }

  if (spec.actions) {
    for (const a of spec.actions) {
      if (!a.id) errors.push('action without id')
      if (!a.label) errors.push(`action ${a.id ?? '?'}: label required`)
    }
  }

  if (spec.playground && !spec.playground.route?.startsWith('/'))
    errors.push('playground.route must start with "/"')

  if (spec.train) {
    if (!spec.train.entry) errors.push('train.entry required')
    if (!spec.train.deps) errors.push('train.deps required (pyproject.toml or requirements.txt)')
    if (!spec.train.invocation?.length) errors.push('train.invocation must be non-empty')
  }

  if (spec.tests?.required?.length) {
    for (const t of spec.tests.required) {
      if (t === 'l1' && !spec.tests.l1) warnings.push('tests.required includes l1 but tests.l1 is unset')
      if (t === 'l2' && !spec.tests.l2) warnings.push('tests.required includes l2 but tests.l2 is unset')
      if (t === 'l3' && !spec.tests.l3) warnings.push('tests.required includes l3 but tests.l3 is unset')
    }
  }

  return { ok: errors.length === 0, errors, warnings }
}

/** Compute the ADR-025 maturity scorecard from a spec + evidence flags. */
export function scoreModule(
  spec: ModuleSpec,
  evidence: Partial<Record<'core' | 'spec' | 'panel' | 'tests' | 'playground' | 'targets', boolean>>,
): ModuleScorecard {
  const axes = {
    core: evidence.core ?? false,
    spec: validateModuleSpec(spec).ok,
    panel: evidence.panel ?? false,
    tests: (evidence.tests ?? false) && spec.tests?.required.every((t) => spec.tests?.[t]),
    playground: evidence.playground ?? Boolean(spec.playground?.entry),
    targets: evidence.targets ?? Boolean(spec.runtime?.web && (spec.runtime?.local || spec.runtime?.cloud || spec.runtime?.device)),
  }
  return { meta: spec.meta, axes }
}
