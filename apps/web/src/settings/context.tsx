/**
 * Settings context - app-level settings provider (issue #52).
 *
 * `SettingsProvider` loads platform + module settings from localStorage on
 * mount and exposes `useAppSettings()` for reading and updating. Theme
 * side-effects (documentElement.dataset.theme + meta theme-color) live here
 * so any consumer that changes `theme` gets an immediate effect.
 *
 * `system` mode follows `prefers-color-scheme` via matchMedia (with a live
 * listener), resolving to the actual light/dark token value at render time.
 */

import * as React from 'react'
import { PLATFORM_DEFAULTS, PLATFORM_SETTING_IDS } from './schema'
import {
  loadModuleSettings,
  loadPlatformSettings,
  saveModuleSettings,
  savePlatformSettings,
  loadKwsSources,
  saveKwsSources,
  resetSettings,
} from './storage'
import type { KwsSourcesSettings } from './storage'
import type { ModuleSettings, PlatformSettings, PlatformSettingId, ThemeMode } from './types'

interface SettingsContextValue {
  /** Resolved platform settings (theme already applied to the document). */
  platform: PlatformSettings
  /** Module settings per backend id (driver spec params). */
  module: ModuleSettings
  setPlatform: (patch: Partial<PlatformSettings>) => void
  setModuleBackend: (backendId: string, values: Record<string, unknown>) => void
  /** Persist a single platform setting. */
  /** Persist a single platform setting. */
  set: (id: PlatformSettingId, value: unknown) => void
  /** App-level KWS model-source defaults (#52/#53 layered persistence). */
  kwsSources: KwsSourcesSettings
  setKwsSources: (s: KwsSourcesSettings) => void
  /** Reset everything to defaults (clears localStorage). */
  reset: () => void
  /** The theme that is actually applied (system resolved). */
  resolvedTheme: Exclude<ThemeMode, 'system'>
}

const SettingsContext = React.createContext<SettingsContextValue | null>(null)

/** Resolve `system` to light/dark using matchMedia (defaults to light). */
export function resolveSystemTheme(): Exclude<ThemeMode, 'system'> {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** Apply the theme to the document (data-theme + meta theme-color). */
export function applyTheme(mode: ThemeMode): void {
  const resolved = mode === 'system' ? resolveSystemTheme() : mode
  if (typeof document === 'undefined') return
  document.documentElement.dataset.theme = resolved
  document.documentElement.style.colorScheme = resolved
  // Update the PWA theme-color meta (light/dark accent).
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', resolved === 'dark' ? '#0b1020' : '#0ea5e9')
}

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [platform, setPlatformState] = React.useState<PlatformSettings>(() =>
    loadPlatformSettings(),
  )
  const [module, setModuleState] = React.useState<ModuleSettings>(() =>
    loadModuleSettings(),
  )
  const [kwsSources, setKwsSourcesState] = React.useState<KwsSourcesSettings>(() =>
    loadKwsSources(),
  )
  // Follow OS theme changes when in `system` mode.
  const [osTheme, setOsTheme] = React.useState<'light' | 'dark'>('light')

  React.useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (e: MediaQueryListEvent) => setOsTheme(e.matches ? 'dark' : 'light')
    // iOS Safari: addEventListener may not exist on MediaQueryList.
    if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onChange)
    return () => {
      if (typeof mq.removeEventListener === 'function') mq.removeEventListener('change', onChange)
    }
  }, [])

  // Apply the theme whenever the setting or OS preference changes.
  const theme: ThemeMode = platform.theme ?? PLATFORM_DEFAULTS.theme
  React.useEffect(() => {
    applyTheme(theme)
  }, [theme, osTheme])

  const resolvedTheme: Exclude<ThemeMode, 'system'> =
    theme === 'system' ? osTheme : theme

  const setPlatform = React.useCallback(
    (patch: Partial<PlatformSettings>) => {
      setPlatformState((prev) => {
        const next = { ...prev, ...patch }
        savePlatformSettings(next)
        return next
      })
    },
    [],
  )

  const set = React.useCallback(
    (id: PlatformSettingId, value: unknown) => {
      setPlatformState((prev) => {
        const next: PlatformSettings = { ...prev, [id]: value as never }
        savePlatformSettings(next)
        return next
      })
    },
    [],
  )

  const setModuleBackend = React.useCallback(
    (backendId: string, values: Record<string, unknown>) => {
      saveModuleSettings(backendId, values)
      setModuleState((prev) => ({ ...prev, [backendId]: { ...values } }))
    },
    [],
  )

  const setKwsSources = React.useCallback((s: KwsSourcesSettings) => {
    saveKwsSources(s)
    setKwsSourcesState(s)
  }, [])

  const reset = React.useCallback(() => {
    resetSettings()
    setPlatformState({ ...PLATFORM_DEFAULTS })
    setModuleState({})
  }, [])

  const value: SettingsContextValue = {
    platform,
    module,
    setPlatform,
    setModuleBackend,
    set,
    reset,
    resolvedTheme,
    kwsSources,
    setKwsSources,
  }

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export function useAppSettings(): SettingsContextValue {
  const ctx = React.useContext(SettingsContext)
  if (!ctx) throw new Error('useAppSettings must be used within SettingsProvider')
  return ctx
}

// Re-export for convenience (id type used by callers).
export type { PlatformSettingId }
export { PLATFORM_SETTING_IDS }
