/**
 * Settings view (issue #52) - section content only, save-to-apply.
 *
 * The section menu lives in the shell sidebar (Settings sub-menu); this view
 * renders the selected section's content full-width, driven by the route
 * (settings-general / settings-security / settings-data / settings-modules).
 *
 * One shared draft (platform + module) lives here; a single Save button at
 * the bottom persists everything at once (localStorage + immediate theme
 * effect). No export/import, no reset.
 */

import * as React from 'react'
import { renderParamRow } from '@wake-studio/module-kit'
import { useToast } from '../components/toast'
import {
  ModuleSettingsSection,
  seedModuleDraft,
  type ModuleDraftMap,
} from '../settings/ModuleSettings'
import {
  PLATFORM_SETTING_DESCRIPTORS,
  descriptorToModuleParam,
  settingGroupOf,
} from '../settings'
import { useAppSettings } from '../settings/context'
import type { SettingsSection } from '../router'
import type { PlatformSettingId } from '../settings'

const GROUP_TITLES: Record<SettingsSection, string> = {
  general: 'General',
  security: 'Security',
  data: 'Data',
  modules: 'Module settings',
}

const GROUP_DESCRIPTIONS: Record<SettingsSection, string> = {
  general: 'Console-wide appearance and runtime defaults. Changes apply on Save.',
  security:
    'Backend connection + credentials. Stored locally only; never sent. Changes apply on Save.',
  data: 'Local data preferences and future data-source gates. Changes apply on Save.',
  modules:
    'Per-driver defaults from the module specs (ADR-025). The active project can override these per project. Changes apply on Save.',
}

export function SettingsView({
  section,
  backendId,
}: {
  section: SettingsSection
  /** Driver anchor for the Modules section (Settings -> driver focus). */
  backendId?: string
}) {
  const { platform, set, module, setModuleBackend } = useAppSettings()
  const { toast } = useToast()

  // Shared draft: platform fields + per-driver module values.
  const [platformDraft, setPlatformDraft] = React.useState<
    Record<PlatformSettingId, unknown>
  >(() => {
    const out = {} as Record<PlatformSettingId, unknown>
    for (const d of PLATFORM_SETTING_DESCRIPTORS) {
      out[d.id] = platform[d.id] ?? d.default
    }
    return out
  })
  const [moduleDraft, setModuleDraft] = React.useState<ModuleDraftMap>(() =>
    seedModuleDraft(module),
  )
  const [dirty, setDirty] = React.useState(false)

  // Re-seed the draft when the section changes (avoid stale values).
  React.useEffect(() => {
    const out = {} as Record<PlatformSettingId, unknown>
    for (const d of PLATFORM_SETTING_DESCRIPTORS) {
      out[d.id] = platform[d.id] ?? d.default
    }
    setPlatformDraft(out)
    setModuleDraft(seedModuleDraft(module))
    setDirty(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section])

  const handlePlatformChange = (id: PlatformSettingId, value: unknown) => {
    setPlatformDraft((prev) => ({ ...prev, [id]: value }))
    setDirty(true)
  }

  const handleModuleChange = (
    backendId_: string,
    paramId: string,
    value: unknown,
  ) => {
    setModuleDraft((prev) => ({
      ...prev,
      [backendId_]: { ...prev[backendId_], [paramId]: value },
    }))
    setDirty(true)
  }

  const handleSave = () => {
    // Persist all platform draft fields.
    for (const [id, value] of Object.entries(platformDraft)) {
      set(id as PlatformSettingId, value)
    }
    // Persist all module draft values.
    for (const [backendId_, values] of Object.entries(moduleDraft)) {
      setModuleBackend(backendId_, { ...values })
    }
    setDirty(false)
    toast({ title: 'Settings saved', variant: 'success' })
  }

  const platformIds = PLATFORM_SETTING_DESCRIPTORS.filter(
    (d) => settingGroupOf(d.id) === section,
  )

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-ink-1">
          {GROUP_TITLES[section]}
        </h2>
        <p className="mt-1 text-sm text-ink-2">{GROUP_DESCRIPTIONS[section]}</p>
      </div>

      <div className="space-y-4">
        {section === 'modules' ? (
          <ModuleSettingsSection
            values={moduleDraft}
            onChange={handleModuleChange}
            focusBackendId={backendId}
          />
        ) : (
          <div className="rounded-xl border border-line bg-surface-2 p-5">
            <div className="divide-y divide-line">
              {platformIds.map((d) => (
                <div key={d.id} className="py-1">
                  {renderParamRow(
                    descriptorToModuleParam(d),
                    platformDraft[d.id],
                    (v: unknown) => handlePlatformChange(d.id, v),
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {section === 'security' && (
          <p className="rounded-lg border border-line bg-surface-3 px-3 py-2 text-xs text-ink-3">
            Credentials never leave this browser. Changes apply on Save.
          </p>
        )}
      </div>

      {/* Bottom action bar: single Save for the whole settings section. */}
      <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
        <span className="text-xs text-ink-3">
          {dirty ? 'Unsaved changes' : 'All changes saved'}
        </span>
        <button
          onClick={handleSave}
          disabled={!dirty}
          className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-400 disabled:opacity-40"
        >
          Save
        </button>
      </div>
    </div>
  )
}
