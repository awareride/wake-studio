/**
 * Settings view (issue #52) - replaces the ComingSoon placeholder.
 *
 * Data-driven: platform settings render from `PLATFORM_SETTING_DESCRIPTORS`
 * via module-kit controls; module settings render from each driver's spec
 * (ADR-025). Left rail groups: General / Security / Data / Modules.
 *
 * Export/import JSON (secrets masked on export) + reset-to-defaults.
 */

import * as React from 'react'
import { renderParamRow } from '@wake-studio/module-kit'
import { cn } from '../components/cn'
import { useToast } from '../components/toast'
import { ModuleSettingsSection } from '../settings/ModuleSettings'
import {
  PLATFORM_SETTING_DESCRIPTORS,
  buildExportPayload,
  descriptorToModuleParam,
  parseImportPayload,
  settingGroupOf,
} from '../settings'
import { useAppSettings } from '../settings/context'

type RailGroup = 'general' | 'security' | 'data' | 'modules'

const RAIL: ReadonlyArray<{ id: RailGroup; label: string }> = [
  { id: 'general', label: 'General' },
  { id: 'security', label: 'Security' },
  { id: 'data', label: 'Data' },
  { id: 'modules', label: 'Modules' },
]

const GROUP_TITLES: Record<RailGroup, string> = {
  general: 'General',
  security: 'Security',
  data: 'Data',
  modules: 'Module settings',
}

const GROUP_DESCRIPTIONS: Record<RailGroup, string> = {
  general: 'Console-wide appearance and runtime defaults.',
  security: 'Backend connection + credentials. Stored locally only; secrets are masked on export and never sent.',
  data: 'Local data preferences and future data-source gates.',
  modules: 'Per-driver defaults from the module specs (ADR-025). The active project can override these per project.',
}

export function SettingsView() {
  const { platform, set, module, setModuleBackend, reset } = useAppSettings()
  const { toast } = useToast()
  const [rail, setRail] = React.useState<RailGroup>('general')
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)

  const handleExport = () => {
    const payload = buildExportPayload(platform, module, true)
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'wake-studio-settings.json'
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    toast({ title: 'Settings exported', description: 'Secrets are masked (••••••••).' })
  }

  const handleImport = (file: File | undefined) => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed = parseImportPayload(String(reader.result))
        // Apply parsed platform values via set() (persists), then module map.
        for (const [id, value] of Object.entries(parsed.platform)) {
          if (id !== 'schemaVersion') set(id as never, value)
        }
        for (const [backendId, values] of Object.entries(parsed.module)) {
          setModuleBackend(backendId, values as Record<string, unknown>)
        }
        toast({ title: 'Settings imported', variant: 'success' })
      } catch (err) {
        toast({
          title: 'Import failed',
          description: err instanceof Error ? err.message : String(err),
          variant: 'error',
        })
      }
    }
    reader.readAsText(file)
  }

  const handleReset = () => {
    reset()
    toast({ title: 'Settings reset', description: 'All app settings restored to defaults.' })
  }

  const platformIds = PLATFORM_SETTING_DESCRIPTORS.filter(
    (d) => settingGroupOf(d.id) === rail,
  )

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-ink-1">Settings</h2>
        <p className="mt-1 max-w-2xl text-sm text-ink-2">
          App-level settings, stored locally in your browser. Module settings
          are generated from the module specs (ADR-025) — a new driver with a
          spec appears here automatically.
        </p>
      </div>

      <div className="flex gap-6">
        {/* Left rail */}
        <nav className="w-44 shrink-0 space-y-0.5">
          {RAIL.map((r) => (
            <button
              key={r.id}
              onClick={() => setRail(r.id)}
              aria-current={rail === r.id ? 'page' : undefined}
              className={cn(
                'w-full rounded-lg px-2.5 py-1.5 text-left text-sm font-medium transition-colors',
                rail === r.id
                  ? 'bg-brand-500/10 text-brand-700'
                  : 'text-ink-2 hover:bg-surface-3 hover:text-ink-1',
              )}
            >
              {r.label}
            </button>
          ))}
        </nav>

        {/* Content */}
        <div className="min-w-0 flex-1 space-y-4">
          <div className="rounded-xl border border-line bg-surface-2 p-5">
            <h3 className="text-sm font-semibold text-ink-1">
              {GROUP_TITLES[rail]}
            </h3>
            <p className="mt-1 mb-3 text-xs text-ink-3">
              {GROUP_DESCRIPTIONS[rail]}
            </p>

            {rail === 'modules' ? (
              <ModuleSettingsSection />
            ) : (
              <div className="divide-y divide-line">
                {platformIds.map((d) => (
                  <div key={d.id} className="py-1">
                    {renderParamRow(
                      descriptorToModuleParam(d),
                      platform[d.id] ?? d.default,
                      (v: unknown) => set(d.id, v),
                    )}
                  </div>
                ))}
              </div>
            )}

            {rail === 'security' && (
              <p className="mt-4 rounded-lg border border-line bg-surface-3 px-3 py-2 text-xs text-ink-3">
                Credentials never leave this browser. Export masks secrets
                with ••••••••; imports overwrite them.
              </p>
            )}
          </div>

          {/* Global actions */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleExport}
              className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink-2 hover:bg-surface-3"
            >
              Export settings (JSON)
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink-2 hover:bg-surface-3"
            >
              Import settings…
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                handleImport(e.target.files?.[0])
                e.target.value = ''
              }}
            />
            <button
              onClick={handleReset}
              className="rounded-lg border border-danger/40 px-3 py-1.5 text-sm text-danger hover:bg-danger/10"
            >
              Reset to defaults
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
