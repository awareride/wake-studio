/**
 * Module settings - registry-driven module groups (issue #52).
 *
 * Iterates the KWS backend registry and renders one group per driver that
 * carries a `spec` (ADR-025). Only drivers WITH a spec are listed.
 *
 * Controlled: the host (SettingsView) owns the draft values + Save; this
 * component renders the driver cards and reports edits via onChange.
 */

import * as React from 'react'
import { renderParamRow } from '@wake-studio/module-kit'
import { getBackendRegistry } from '@wake-studio/module-kws-engine'
import type { ModuleParam } from '@wake-studio/contracts'
import { mergeModuleDefaults } from './storage'
import { cn } from '../components/cn'

export type ModuleDraftMap = Record<string, Record<string, unknown>>

/** A spec-bearing driver (ADR-025) - the ones shown in module settings. */
export interface SpecDriver {
  id: string
  label: string
  params: ReadonlyArray<ModuleParam>
}

/** Drivers that carry a spec - the ones shown in module settings. */
export function getSpecDrivers(): ReadonlyArray<SpecDriver> {
  return getBackendRegistry()
    .filter((r) => r.spec?.params?.length)
    .map((r) => ({ id: r.id, label: r.label, params: r.spec!.params }))
}

/** Seed a module draft from persisted settings + spec defaults. */
export function seedModuleDraft(
  module: Record<string, Record<string, unknown>>,
): ModuleDraftMap {
  const out: ModuleDraftMap = {}
  for (const d of getSpecDrivers()) {
    const defaults = Object.fromEntries(
      d.params.map((p) => [p.id, p.default]),
    )
    out[d.id] = mergeModuleDefaults(module[d.id], defaults)
  }
  return out
}

export function ModuleSettingsSection({
  values,
  onChange,
  focusBackendId,
}: {
  /** Draft values per backend id (controlled by the host). */
  values: ModuleDraftMap
  onChange: (backendId: string, paramId: string, value: unknown) => void
  /** Driver to keep focused (from the sidebar Settings -> driver). */
  focusBackendId?: string
}) {
  const drivers = React.useMemo(() => getSpecDrivers(), [])

  // Scroll the focused driver card into view once.
  const focusedRef = React.useRef<HTMLDivElement | null>(null)
  React.useEffect(() => {
    if (focusBackendId && focusedRef.current) {
      focusedRef.current.scrollIntoView({ block: 'start', behavior: 'smooth' })
    }
  }, [focusBackendId])

  if (drivers.length === 0) {
    return (
      <p className="text-sm text-ink-3">
        No module settings yet — drivers that carry a spec appear here
        automatically.
      </p>
    )
  }

  return (
    <div className="space-y-6">
      {drivers.map((driver) => {
        const valuesForDriver = values[driver.id] ?? {}
        const focused = driver.id === focusBackendId
        return (
          <div
            key={driver.id}
            ref={focused ? focusedRef : undefined}
            className={cn(
              'rounded-xl border bg-surface-2 p-5 transition-opacity',
              focused
                ? 'border-brand-400 ring-1 ring-brand-400/30'
                : 'border-line',
            )}
          >
            <h3 className="mb-1 text-sm font-semibold text-ink-1">
              {driver.label}
              {focused && (
                <span className="ml-2 rounded bg-brand-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-brand-700">
                  active
                </span>
              )}
            </h3>
            <p className="mb-3 text-xs text-ink-3">
              Params from the driver module spec (ADR-025). Changes apply on
              Save; per-project overrides live in the project snapshot.
            </p>
            <div className="divide-y divide-line">
              {driver.params.map((param) => (
                <div key={param.id} className="py-1">
                  {renderParamRow(
                    param,
                    valuesForDriver[param.id] ?? param.default,
                    (v: unknown) => onChange(driver.id, param.id, v),
                  )}
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
