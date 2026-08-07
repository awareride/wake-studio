/**
 * Module settings - registry-driven module groups (issue #52).
 *
 * Iterates the KWS backend registry and renders one group per driver that
 * carries a `spec` (ADR-025). Only drivers WITH a spec are listed.
 *
 * Edits accumulate in a local draft; the section's Save button persists all
 * driver values to `wake-studio:settings:module` (per backendId) at once
 * (save-to-apply). These are the app-level defaults; the KWS panel (#53 P1)
 * reads them as seeds and lets the active project's snapshot override per
 * project.
 */

import * as React from 'react'
import { renderParamRow } from '@wake-studio/module-kit'
import { getBackendRegistry } from '@wake-studio/module-kws-engine'
import { useAppSettings } from './context'
import { useToast } from '../components/toast'
import { mergeModuleDefaults } from './storage'
import { cn } from '../components/cn'

type DraftMap = Record<string, Record<string, unknown>>

export function ModuleSettingsSection({
  focusBackendId,
}: {
  /** Driver to keep focused (from the sidebar Settings -> driver). */
  focusBackendId?: string
}) {
  const { module, setModuleBackend } = useAppSettings()
  const { toast } = useToast()
  const drivers = React.useMemo(
    () => getBackendRegistry().filter((r) => r.spec?.params?.length),
    [],
  )

  // Local draft: seeded from persisted module settings + spec defaults.
  const [draft, setDraft] = React.useState<DraftMap>(() => {
    const out: DraftMap = {}
    for (const d of drivers) {
      const defaults = Object.fromEntries(
        d.spec!.params.map((p) => [p.id, p.default]),
      )
      out[d.id] = mergeModuleDefaults(module[d.id], defaults)
    }
    return out
  })
  const [dirty, setDirty] = React.useState(false)

  // Re-seed when the section mounts / module settings change from elsewhere.
  React.useEffect(() => {
    const out: DraftMap = {}
    for (const d of drivers) {
      const defaults = Object.fromEntries(
        d.spec!.params.map((p) => [p.id, p.default]),
      )
      out[d.id] = mergeModuleDefaults(module[d.id], defaults)
    }
    setDraft(out)
    setDirty(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drivers])

  // Scroll the focused driver card into view once.
  const focusedRef = React.useRef<HTMLDivElement | null>(null)
  React.useEffect(() => {
    if (focusBackendId && focusedRef.current) {
      focusedRef.current.scrollIntoView({ block: 'start', behavior: 'smooth' })
    }
  }, [focusBackendId])

  const handleDraftChange = (backendId: string, paramId: string, value: unknown) => {
    setDraft((prev) => ({
      ...prev,
      [backendId]: { ...prev[backendId], [paramId]: value },
    }))
    setDirty(true)
  }

  const handleSave = () => {
    for (const [backendId, values] of Object.entries(draft)) {
      setModuleBackend(backendId, { ...values })
    }
    setDirty(false)
    toast({ title: 'Module settings saved', variant: 'success' })
  }

  if (drivers.length === 0) {
    return (
      <p className="text-sm text-ink-3">
        No module settings yet — drivers that carry a spec appear here
        automatically.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={!dirty}
          className="rounded-lg bg-brand-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-400 disabled:opacity-40"
        >
          Save
        </button>
      </div>

      <div className="space-y-6">
        {drivers.map((driver) => {
          const values = draft[driver.id] ?? {}
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
                {driver.spec!.params.map((param) => (
                  <div key={param.id} className="py-1">
                    {renderParamRow(
                      param,
                      values[param.id] ?? param.default,
                      (v: unknown) => handleDraftChange(driver.id, param.id, v),
                    )}
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
