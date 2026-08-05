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
      const options = (param.options ?? []).map((o) => ({ value: o.value, label: o.label }))
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
          className="h-8 w-48 rounded-lg border border-white/10 bg-slate-800/60 px-2.5 text-sm text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:opacity-40"
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
