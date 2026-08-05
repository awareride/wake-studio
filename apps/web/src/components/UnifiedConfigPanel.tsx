/**
 * Unified config panel (Phase 2 - read-side unification).
 *
 * Renders any module's `ParameterDescriptor[]` (AFE / KWS / Few-Shot
 * `describeParameters()`) through the module-kit spec-driven controls
 * (`renderParamRow`), instead of hand-written <select>/<input> JSX.
 *
 * Read-side only for now: the descriptor drives HOW a control renders
 * (label/type/min/max/step/options); writes still go through the panel's
 * existing setConfig() path. This keeps the change low-risk while making
 * module-kit the single source of truth for control rendering (ADR-025).
 */

import type { ModuleParam } from '@wake-studio/contracts'
import { renderParamRow } from '@wake-studio/module-kit'
import type { ParameterDescriptor } from '../afe'
import { cn } from '../components/cn'

export type ParamValue = string | number | boolean

/** Bridge: a module ParameterDescriptor -> a ModuleSpec param shape. */
function toModuleParam(desc: ParameterDescriptor): ModuleParam {
  return {
    id: desc.id,
    label: desc.label,
    group: 'primary', // descriptor groups are handled by the caller's grouping
    type: desc.type === 'number' && desc.min !== undefined && desc.max !== undefined && desc.step !== undefined ? 'slider' : desc.type,
    default: desc.default,
    min: desc.min,
    max: desc.max,
    step: desc.step,
    unit: desc.unit,
    description: desc.description,
    options: desc.options,
  }
}

interface UnifiedConfigPanelProps {
  title: string
  subtitle?: string
  params: ReadonlyArray<ParameterDescriptor>
  values: Record<string, ParamValue>
  onParamChange: (id: string, value: ParamValue) => void
  /** Placeholder for primary/advanced grouping (used by the panels). */
  group?: 'primary' | 'advanced'
  className?: string
}

export function UnifiedConfigPanel({
  title,
  subtitle,
  params,
  values,
  onParamChange,
  className,
}: UnifiedConfigPanelProps) {
  return (
    <div className={cn('rounded-xl border border-line bg-surface-2 p-5', className)}>
      {title && <h3 className="mb-1 text-sm font-semibold text-ink-1">{title}</h3>}
      {subtitle && <p className="mb-3 text-xs text-ink-3">{subtitle}</p>}
      <div className="divide-y divide-line">
        {params.map((desc) => (
          <div key={desc.id}>
            {renderParamRow(toModuleParam(desc), values[desc.id] ?? desc.default, (v: unknown) =>
              onParamChange(desc.id, v as ParamValue),
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export { toModuleParam }
