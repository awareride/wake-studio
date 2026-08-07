/**
 * Settings view (issue #52) - section content only, save-to-apply.
 *
 * The section menu lives in the shell sidebar (Settings sub-menu); this view
 * renders the selected section's content full-width, driven by the route
 * (settings-general / settings-security / settings-data / settings-modules).
 *
 * Edits go into a local draft; a single Save button persists them
 * (localStorage + immediate theme effect). No export/import, no reset.
 */

import * as React from 'react'
import { renderParamRow } from '@wake-studio/module-kit'
import { useToast } from '../components/toast'
import { ModuleSettingsSection } from '../settings/ModuleSettings'
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
  const { platform, set } = useAppSettings()
  const { toast } = useToast()

  // Local draft: edits accumulate here; Save persists them.
  const [draft, setDraft] = React.useState<
    Record<PlatformSettingId, unknown>
  >(() => {
    const out = {} as Record<PlatformSettingId, unknown>
    for (const d of PLATFORM_SETTING_DESCRIPTORS) {
      out[d.id] = platform[d.id] ?? d.default
    }
    return out
  })
  const [dirty, setDirty] = React.useState(false)

  // Re-seed the draft when the section changes (avoid stale values).
  React.useEffect(() => {
    const out = {} as Record<PlatformSettingId, unknown>
    for (const d of PLATFORM_SETTING_DESCRIPTORS) {
      out[d.id] = platform[d.id] ?? d.default
    }
    setDraft(out)
    setDirty(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section])

  const handleDraftChange = (id: PlatformSettingId, value: unknown) => {
    setDraft((prev) => ({ ...prev, [id]: value }))
    setDirty(true)
  }

  const handleSave = () => {
    // Persist all draft fields (platform).
    for (const [id, value] of Object.entries(draft)) {
      set(id as PlatformSettingId, value)
    }
    setDirty(false)
    toast({ title: 'Settings saved', variant: 'success' })
  }

  const platformIds = PLATFORM_SETTING_DESCRIPTORS.filter(
    (d) => settingGroupOf(d.id) === section,
  )

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-ink-1">
            {GROUP_TITLES[section]}
          </h2>
          <p className="mt-1 text-sm text-ink-2">{GROUP_DESCRIPTIONS[section]}</p>
        </div>
        <button
          onClick={handleSave}
          disabled={!dirty}
          className="rounded-lg bg-brand-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-400 disabled:opacity-40"
        >
          Save
        </button>
      </div>

      <div className="space-y-4">
        {section === 'modules' ? (
          <ModuleSettingsSection focusBackendId={backendId} />
        ) : (
          <div className="rounded-xl border border-line bg-surface-2 p-5">
            <div className="divide-y divide-line">
              {platformIds.map((d) => (
                <div key={d.id} className="py-1">
                  {renderParamRow(
                    descriptorToModuleParam(d),
                    draft[d.id],
                    (v: unknown) => handleDraftChange(d.id, v),
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
    </div>
  )
}
