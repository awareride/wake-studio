/**
 * Module settings - registry-driven module groups (issue #52).
 *
 * Iterates the KWS backend registry and renders one group per driver that
 * carries a `spec` (ADR-025). Only drivers WITH a spec are listed
 * (human-confirmed): openwakeword has no spec.params today, so sherpa and
 * plix appear.
 *
 * Values persist to `wake-studio:settings:module` (per backendId). These are
 * the app-level defaults; the KWS panel (issue #53 P1) reads them as seeds
 * and lets the active project's snapshot override per project.
 */

import * as React from 'react'
import { renderParamRow } from '@wake-studio/module-kit'
import { getBackendRegistry } from '@wake-studio/module-kws-engine'
import { useAppSettings } from './context'
import { mergeModuleDefaults } from './storage'

export function ModuleSettingsSection() {
  const { module, setModuleBackend } = useAppSettings()
  const drivers = React.useMemo(
    () => getBackendRegistry().filter((r) => r.spec?.params?.length),
    [],
  )

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
        const defaults = Object.fromEntries(
          driver.spec!.params.map((p) => [p.id, p.default]),
        )
        const values = mergeModuleDefaults(module[driver.id], defaults)
        return (
          <div
            key={driver.id}
            className="rounded-xl border border-line bg-surface-2 p-5"
          >
            <h3 className="mb-1 text-sm font-semibold text-ink-1">
              {driver.label}
            </h3>
            <p className="mb-3 text-xs text-ink-3">
              Params from the driver module spec (ADR-025). Persisted locally
              as app defaults; per-project overrides live in the project
              snapshot.
            </p>
            <div className="divide-y divide-line">
              {driver.spec!.params.map((param) => (
                <div key={param.id} className="py-1">
                  {renderParamRow(
                    param,
                    values[param.id] ?? param.default,
                    (v: unknown) =>
                      setModuleBackend(driver.id, {
                        ...values,
                        [param.id]: v,
                      }),
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
