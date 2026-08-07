/**
 * Settings storage - localStorage persistence (issue #52).
 *
 * Two keys:
 *   - `wake-studio:settings:platform` -> whole PlatformSettings object,
 *     versioned (schemaVersion), merged with defaults on read so new fields
 *     get defaults and old payloads never crash.
 *   - `wake-studio:settings:module`   -> { backendId: { paramId: value } }.
 *
 * localStorage is chosen over IndexedDB because settings are small,
 * synchronous, boot-critical data (matches the existing
 * `wake-studio:last-project` pattern).
 *
 * Security: `secret` values are stored locally only and masked in the export.
 */

import { PLATFORM_DEFAULTS, PLATFORM_SETTING_IDS, isSecretSetting } from './schema'
import type { AppSettings, ModuleSettings, PlatformSettings } from './types'

const PLATFORM_KEY = 'wake-studio:settings:platform'
const MODULE_KEY = 'wake-studio:settings:module'

/** Mask used for secret values in exports (never leaks the real value). */
const SECRET_MASK = '••••••••'

// ---------------------------------------------------------------------------
// Platform settings
// ---------------------------------------------------------------------------

/**
 * Merge a stored platform payload over the defaults. Unknown/extra keys are
 * dropped (we only keep descriptor ids); missing keys get the default.
 */
export function mergePlatformDefaults(
  stored: Partial<PlatformSettings> | null | undefined,
): PlatformSettings {
  const out = { ...PLATFORM_DEFAULTS }
  if (!stored || typeof stored !== 'object') return out
  for (const id of PLATFORM_SETTING_IDS) {
    const v = (stored as Record<string, unknown>)[id]
    if (v !== undefined) (out as Record<string, unknown>)[id] = v
  }
  return out
}

/** Read the platform settings, merged over defaults (never throws). */
export function loadPlatformSettings(): PlatformSettings {
  try {
    const raw = localStorage.getItem(PLATFORM_KEY)
    if (!raw) return { ...PLATFORM_DEFAULTS }
    const parsed = JSON.parse(raw) as Partial<PlatformSettings>
    return mergePlatformDefaults(parsed)
  } catch {
    // Corrupt/private-mode storage - fall back to defaults.
    return { ...PLATFORM_DEFAULTS }
  }
}

/** Persist the platform settings (writes the whole object, versioned). */
export function savePlatformSettings(settings: PlatformSettings): void {
  try {
    localStorage.setItem(PLATFORM_KEY, JSON.stringify({ ...settings, schemaVersion: PLATFORM_DEFAULTS.schemaVersion }))
  } catch {
    // Storage full/blocked - ignore; settings stay in-memory for the session.
  }
}

// ---------------------------------------------------------------------------
// Module settings
// ---------------------------------------------------------------------------

/** Reserved key in the module map for KWS model-source app defaults (#52/#53).
 *  Not a backend id - excluded from the module settings UI (registry-driven). */
export const KWS_SOURCES_KEY = 'kws-sources'

/** App-level defaults for the KWS model-source editor. */
export interface KwsSourcesSettings {
  modelSources: Record<string, string | undefined>
  customUrls: Record<string, string>
}

/** Read the module settings map (per backendId). Never throws. */
export function loadModuleSettings(): ModuleSettings {
  try {
    const raw = localStorage.getItem(MODULE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as ModuleSettings
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/** Read the app-level KWS model-source defaults (never throws). */
export function loadKwsSources(): KwsSourcesSettings {
  const m = loadModuleSettings()
  const s = m[KWS_SOURCES_KEY] as Partial<KwsSourcesSettings> | undefined
  return {
    modelSources: s?.modelSources && typeof s.modelSources === 'object' ? s.modelSources : {},
    customUrls: s?.customUrls && typeof s.customUrls === 'object' ? s.customUrls : {},
  }
}

/** Persist the app-level KWS model-source defaults. */
export function saveKwsSources(settings: KwsSourcesSettings): void {
  try {
    const all = loadModuleSettings()
    all[KWS_SOURCES_KEY] = { ...settings } as unknown as Record<string, unknown>
    localStorage.setItem(MODULE_KEY, JSON.stringify(all))
  } catch {
    // ignore
  }
}

/** Merge one backend's stored values over its spec defaults. */
export function mergeModuleDefaults(
  stored: Record<string, unknown> | undefined,
  defaults: Record<string, unknown>,
): Record<string, unknown> {
  return { ...defaults, ...(stored ?? {}) }
}

/** Persist one backend's values (reads-modifies-writes the whole map). */
export function saveModuleSettings(backendId: string, values: Record<string, unknown>): void {
  try {
    const all = loadModuleSettings()
    all[backendId] = { ...values }
    localStorage.setItem(MODULE_KEY, JSON.stringify(all))
  } catch {
    // ignore
  }
}

/** Read a single backend's stored values (or undefined). */
export function getModuleSettings(backendId: string): Record<string, unknown> | undefined {
  return loadModuleSettings()[backendId]
}

// ---------------------------------------------------------------------------
// Export / import / reset
// ---------------------------------------------------------------------------

/**
 * Build the export payload with secrets masked. `maskSecrets=false` yields
 * the real values (used only for round-tripping via import, never for a
 * user-facing download without a warning - see SettingsView).
 */
export function buildExportPayload(
  platform: PlatformSettings,
  module: ModuleSettings,
  maskSecrets: boolean,
): AppSettings {
  const platformOut = { ...platform }
  if (maskSecrets) {
    for (const id of PLATFORM_SETTING_IDS) {
      if (isSecretSetting(id)) {
        const v = (platformOut as Record<string, unknown>)[id]
        if (typeof v === 'string' && v.length > 0) {
          ;(platformOut as Record<string, unknown>)[id] = SECRET_MASK
        }
      }
    }
  }
  return { platform: platformOut, module: JSON.parse(JSON.stringify(module)) }
}

/** Parse an imported payload, applying defaults for missing/unknown fields. */
export function parseImportPayload(raw: string): AppSettings {
  const parsed = JSON.parse(raw) as Partial<AppSettings>
  const platform = mergePlatformDefaults(
    parsed.platform as Partial<PlatformSettings> | undefined,
  )
  const module: ModuleSettings =
    parsed.module && typeof parsed.module === 'object'
      ? (parsed.module as ModuleSettings)
      : {}
  return { platform, module }
}

/** Reset platform + module settings to defaults. */
export function resetSettings(): void {
  try {
    localStorage.removeItem(PLATFORM_KEY)
    localStorage.removeItem(MODULE_KEY)
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Keys (exported for tests / debugging)
// ---------------------------------------------------------------------------

export const SETTINGS_STORAGE_KEYS = { platform: PLATFORM_KEY, module: MODULE_KEY } as const
