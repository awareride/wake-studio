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
import { cn } from '../components/cn'

export function ModuleSettingsSection({
  focusBackendId,
}: {
  /** Driver to keep focused (from the sidebar Settings -> driver). */
  focusBackendId?: string
}) {
  const { module, setModuleBackend } = useAppSettings()
  const drivers = React.useMemo(
    () => getBackendRegistry().filter((r) => r.spec?.params?.length),
    [],
  )

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
        const defaults = Object.fromEntries(
          driver.spec!.params.map((p) => [p.id, p.default]),
        )
        const values = mergeModuleDefaults(module[driver.id], defaults)
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
