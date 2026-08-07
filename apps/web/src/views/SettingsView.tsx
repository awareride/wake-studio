/**
 * Settings view (issue #52) - section content only.
 *
 * The section menu lives in the shell sidebar (Settings sub-menu); this view
 * renders the selected section's content full-width, driven by the route
 * (settings-general / settings-security / settings-data / settings-modules).
 *
 * Data-driven: platform settings render from `PLATFORM_SETTING_DESCRIPTORS`
 * via module-kit controls; module settings render from each driver's spec
 * (ADR-025). Export/import JSON (secrets masked on export) + reset live in
 * a footer bar shared across sections.
 */

import * as React from 'react'
import { renderParamRow } from '@wake-studio/module-kit'
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
import type { SettingsSection } from '../router'

const GROUP_TITLES: Record<SettingsSection, string> = {
  general: 'General',
  security: 'Security',
  data: 'Data',
  modules: 'Module settings',
}

const GROUP_DESCRIPTIONS: Record<SettingsSection, string> = {
  general: 'Console-wide appearance and runtime defaults.',
  security:
    'Backend connection + credentials. Stored locally only; secrets are masked on export and never sent.',
  data: 'Local data preferences and future data-source gates.',
  modules:
    'Per-driver defaults from the module specs (ADR-025). The active project can override these per project.',
}

/** The settings sections this view can render (order = sidebar order). */
export const SETTINGS_SECTIONS: ReadonlyArray<SettingsSection> = [
  'general',
  'security',
  'data',
  'modules',
]

export function SettingsView({ section }: { section: SettingsSection }) {
  const { platform, set, module, setModuleBackend, reset } = useAppSettings()
  const { toast } = useToast()
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
    toast({
      title: 'Settings exported',
      description: 'Secrets are masked (••••••••).',
    })
  }

  const handleImport = (file: File | undefined) => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed = parseImportPayload(String(reader.result))
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
    toast({
      title: 'Settings reset',
      description: 'All app settings restored to defaults.',
    })
  }

  const platformIds = PLATFORM_SETTING_DESCRIPTORS.filter(
    (d) => settingGroupOf(d.id) === section,
  )

  return (
    <div className="space-y-6">
      <div className="max-w-3xl">
        <h2 className="text-lg font-semibold text-ink-1">
          {GROUP_TITLES[section]}
        </h2>
        <p className="mt-1 text-sm text-ink-2">{GROUP_DESCRIPTIONS[section]}</p>
      </div>

      <div className="max-w-3xl space-y-4">
        {section === 'modules' ? (
          <ModuleSettingsSection />
        ) : (
          <div className="rounded-xl border border-line bg-surface-2 p-5">
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
          </div>
        )}

        {section === 'security' && (
          <p className="rounded-lg border border-line bg-surface-3 px-3 py-2 text-xs text-ink-3">
            Credentials never leave this browser. Export masks secrets with
            ••••••••; imports overwrite them.
          </p>
        )}

        {/* Shared actions bar (all sections). */}
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
  )
}
