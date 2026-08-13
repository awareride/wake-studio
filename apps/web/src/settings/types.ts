/**
 * Settings types - app-level settings (issue #52).
 *
 * Two kinds of settings, one renderer:
 *   - platform settings: fixed, console-wide keys (theme, locale, backend
 *     endpoint + secrets, execution provider, data/mic prefs). Described by a
 *     static `SettingDescriptor[]` in schema.ts so module-kit controls render
 *     them unchanged.
 *   - module settings: dynamic, driven by each KWS driver's `spec.params`
 *     (ADR-025). Only drivers that carry a spec are listed.
 *
 * Storage is localStorage only (`wake-studio:settings:*`), versioned so old
 * payloads merge with defaults instead of crashing. `secret` values are
 * stored locally, never sent, and masked in the JSON export.
 *
 * Note (issue #52 scope): settings are the app-level layer; project-level
 * config (per-project snapshot) remains separate and overrides app defaults
 * where they intersect (e.g. KWS driver/model-source persistence in #53 P1
 * reads the module settings as defaults and lets the project snapshot
 * override per project).
 */

/** Platform theme modes. `system` follows `prefers-color-scheme`. */
export type ThemeMode = 'light' | 'dark' | 'system'

/** Accent color themes - Radix Colors scales (https://www.radix-ui.com/colors). */
export type AccentTheme = 'jade' | 'gray' | 'indigo' | 'orange' | 'mint' | 'sky'

/** Locale anchor (store-only for now; i18n lands in Phase 6). */
export type AppLocale = 'en' | 'zh-CN'

/** onnxruntime-web execution provider (ADR-018). */
export type ExecutionProvider = 'webgpu' | 'wasm'

/** Data-retention policy (future export/cleanup anchor). */
export type DataRetention = 'keep' | 'session' | 'export-only'

/** The fixed, console-wide platform settings object. */
export interface PlatformSettings {
  /** Version gate for mergeWithDefaults on read. */
  schemaVersion: number
  theme: ThemeMode
  /** Accent color theme (Radix Colors scale). */
  'theme.accent': AccentTheme
  locale: AppLocale
  'kws.executionProvider': ExecutionProvider
  'backend.endpoint': string
  /** Secret - stored locally only; masked on export. */
  'backend.apiKey': string
  /** Secret - stored locally only; masked on export. */
  'backend.secret': string
  'data.upload': boolean
  'settings.dataRetention': DataRetention
  'mic.rememberPermission': boolean
}

/** Defaults for the platform settings (schemaVersion set by schema.ts). */
export type PlatformSettingId = keyof Omit<PlatformSettings, 'schemaVersion'>

/** Module settings: one value map per backend id (driver spec params). */
export type ModuleSettings = Record<string, Record<string, unknown>>

/** The full app-settings bundle (platform + module). */
export interface AppSettings {
  platform: PlatformSettings
  module: ModuleSettings
}

/** A single platform setting descriptor (aligned to ParameterDescriptor). */
export interface SettingDescriptor {
  id: PlatformSettingId
  label: string
  description: string
  type: 'select' | 'boolean' | 'string' | 'secret'
  default: string | boolean | number
  options?: ReadonlyArray<{ value: string; label: string }>
  /** Group drives the left rail section. */
  group: 'general' | 'security' | 'data'
}
