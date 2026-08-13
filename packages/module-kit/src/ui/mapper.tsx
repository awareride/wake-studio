/**
 * module-kit ui - spec-driven control mapper.
 *
 * Renders a ModuleParam via the right Ui* control, and a ModuleAction via
 * UiButton. The panel generator (docs/module-spec.md §3) calls this so every
 * module's panel is uniform. A new param type requires a spec change + a
 * case here - never a new hand-written panel.
 */

import type { ModuleParam, ModuleAction } from '@wake-studio/contracts'
import { UiSlider, UiNumber, UiSelect, UiToggle, UiParamRow } from './controls'

export interface ParamControlProps {
  param: ModuleParam
  value: unknown
  onChange: (value: unknown) => void
  disabled?: boolean
}

/**
 * Normalize a param's `options` into `{ value, label }[]`.
 *
 * Two shapes exist in the wild and BOTH must render: the ModuleSpec JSON
 * schema declares `options` as `string[]`, while `ModuleParam` types it as
 * `{ value, label }[]`. Specs written to the schema (afe-graph topology,
 * kws-engine executionProvider, training target/backend, kws-streaming
 * wantedWord) produced blank dropdown entries because the renderer read
 * `.label` off a string.
 */
export function normalizeSelectOptions(
  options: ModuleParam['options'] | undefined,
): Array<{ value: string; label: string }> {
  if (!options) return []
  return (options as ReadonlyArray<unknown>).flatMap((o) => {
    if (typeof o === 'string') return [{ value: o, label: o }]
    if (o && typeof o === 'object' && 'value' in o) {
      const { value, label } = o as { value: string; label?: string }
      return [{ value, label: label ?? value }]
    }
    return []
  })
}

/** Render one parameter as its control. */
export function renderParamControl({ param, value, onChange, disabled }: ParamControlProps) {
  switch (param.type) {
    case 'slider':
      return (
        <UiSlider
          value={toNumber(value, param)}
          min={param.min ?? 0}
          max={param.max ?? 1}
          step={param.step ?? 0.1}
          onChange={(v) => onChange(v)}
          disabled={disabled}
          ariaLabel={param.label}
        />
      )
    case 'number':
      return (
        <UiNumber
          value={toNumber(value, param)}
          min={param.min}
          max={param.max}
          step={param.step}
          unit={param.unit}
          onChange={(v) => onChange(v)}
          disabled={disabled}
        />
      )
    case 'select':
    case 'enum': {
      // The ModuleSpec JSON schema declares `options` as a plain string[]
      // ("wasm", "webgpu", ...) while ModuleParam types it as {value,label}[].
      // Specs written to the schema rendered BLANK entries here, because we
      // read `.label` off a string. Accept both shapes so every spec-driven
      // select works, whichever form the spec used.
      const options = normalizeSelectOptions(param.options)
      return (
        <UiSelect
          value={typeof value === 'string' ? value : String(param.default ?? '')}
          options={options}
          onChange={(v) => onChange(v)}
          disabled={disabled}
        />
      )
    }
    case 'boolean':
      return (
        <UiToggle
          checked={Boolean(value ?? param.default)}
          onChange={onChange}
          disabled={disabled}
          label={param.label}
        />
      )
    case 'secret':
      return (
        <input
          type="password"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder="••••••••"
          className="h-8 w-48 rounded-lg border border-line bg-surface-3 px-2.5 text-sm text-ink-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-8 disabled:opacity-40"
        />
      )
    case 'string':
      return (
        <input
          type="text"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder={typeof param.default === 'string' ? String(param.default) : ''}
          className="h-8 w-48 rounded-lg border border-line bg-surface-3 px-2.5 text-sm text-ink-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-8 disabled:opacity-40"
        />
      )
    default:
      return null
  }
}

/** Render a parameter row (label + control). */
export function renderParamRow(
  param: ModuleParam,
  value: unknown,
  onChange: (value: unknown) => void,
  disabled?: boolean,
) {
  return (
    <UiParamRow label={param.label} description={param.description}>
      {renderParamControl({ param, value, onChange, disabled })}
    </UiParamRow>
  )
}

/** Map a ModuleAction kind to a button variant. */
export function actionVariant(kind: ModuleAction['kind']): 'primary' | 'secondary' | 'danger' {
  switch (kind) {
    case 'train':
      return 'primary'
    case 'export':
      return 'primary'
    case 'reset':
      return 'danger'
    case 'start':
      return 'primary'
    case 'stop':
      return 'danger'
    default:
      return 'secondary'
  }
}

function toNumber(value: unknown, param: ModuleParam): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return typeof param.default === 'number' ? param.default : 0
}
