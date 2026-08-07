/**
 * Settings schema - static descriptors for the platform settings (issue #52).
 *
 * The schema is a *descriptor array + value map*: adding a future cloud
 * provider / backend endpoint is just adding more descriptor rows, no new UI
 * code (the "many cloud endpoints" concern from the human review). All values
 * are localStorage-only; `secret` fields are masked on export and never
 * logged or transmitted.
 */

import type { PlatformSettings, PlatformSettingId, SettingDescriptor } from './types'

/** Current schema version. Bump when a field is added/removed. */
export const SETTINGS_SCHEMA_VERSION = 1

/** Default platform settings (schemaVersion is explicit so merge works). */
export const PLATFORM_DEFAULTS: PlatformSettings = {
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  theme: 'light',
  locale: 'en',
  'kws.executionProvider': 'wasm',
  'backend.endpoint': 'http://127.0.0.1:4824',
  'backend.apiKey': '',
  'backend.secret': '',
  'data.upload': false,
  'settings.dataRetention': 'keep',
  'mic.rememberPermission': true,
}

/** Static descriptors - the data-driven source of truth for the platform UI. */
export const PLATFORM_SETTING_DESCRIPTORS: ReadonlyArray<SettingDescriptor> = [
  // ---- General ----
  {
    id: 'theme',
    label: 'Theme',
    description:
      'Console appearance. "System" follows your OS light/dark preference.',
    type: 'select',
    default: 'light',
    options: [
      { value: 'light', label: 'Light' },
      { value: 'dark', label: 'Dark' },
      { value: 'system', label: 'System' },
    ],
    group: 'general',
  },
  {
    id: 'locale',
    label: 'Language',
    description: 'UI language. Stored now; i18n lands in Phase 6.',
    type: 'select',
    default: 'en',
    options: [
      { value: 'en', label: 'English' },
      { value: 'zh-CN', label: '中文 (简体)' },
    ],
    group: 'general',
  },
  {
    id: 'kws.executionProvider',
    label: 'KWS execution provider',
    description:
      'onnxruntime-web execution provider. WebGPU-first with WASM fallback (ADR-018).',
    type: 'select',
    default: 'wasm',
    options: [
      { value: 'webgpu', label: 'WebGPU (faster)' },
      { value: 'wasm', label: 'WASM (universal)' },
    ],
    group: 'general',
  },

  // ---- Security ----
  {
    id: 'backend.endpoint',
    label: 'Backend endpoint',
    description:
      'Self-hosted service base URL (ADR-005). Used by future training/data jobs.',
    type: 'string',
    default: 'http://127.0.0.1:4824',
    group: 'security',
  },
  {
    id: 'backend.apiKey',
    label: 'API key',
    description:
      'Credential for the backend. Stored locally only, never sent to a WakeStudio server, never logged or exported.',
    type: 'secret',
    default: '',
    group: 'security',
  },
  {
    id: 'backend.secret',
    label: 'Secret',
    description:
      'Shared secret for the backend. Same storage guarantees as the API key.',
    type: 'secret',
    default: '',
    group: 'security',
  },

  // ---- Data ----
  {
    id: 'data.upload',
    label: 'Allow data upload',
    description:
      'Gate for the pluggable data-source layer (ADR-022). Off by default; audio generation runs in backends, not WASM.',
    type: 'boolean',
    default: false,
    group: 'data',
  },
  {
    id: 'settings.dataRetention',
    label: 'Data retention',
    description: 'Future export/cleanup policy for local artifacts.',
    type: 'select',
    default: 'keep',
    options: [
      { value: 'keep', label: 'Keep local data' },
      { value: 'session', label: 'Session only' },
      { value: 'export-only', label: 'Export then delete' },
    ],
    group: 'data',
  },
  {
    id: 'mic.rememberPermission',
    label: 'Remember mic permission',
    description:
      'Anchor for the mic permission prompt flow (the browser owns the real permission).',
    type: 'boolean',
    default: true,
    group: 'data',
  },
]

/** All ids with a default (schemaVersion excluded). */
export const PLATFORM_SETTING_IDS: ReadonlyArray<PlatformSettingId> =
  PLATFORM_SETTING_DESCRIPTORS.map((d) => d.id)

/** Map a descriptor id to its group (for the left rail). */
export function settingGroupOf(id: PlatformSettingId): SettingDescriptor['group'] {
  const d = PLATFORM_SETTING_DESCRIPTORS.find((x) => x.id === id)
  return d?.group ?? 'general'
}

/** True when a setting is a secret (password input + masked export). */
export function isSecretSetting(id: PlatformSettingId): boolean {
  return PLATFORM_SETTING_DESCRIPTORS.find((x) => x.id === id)?.type === 'secret'
}

/**
 * Bridge a SettingDescriptor to the module-kit ModuleParam shape so
 * `renderParamRow` renders it unchanged (group is always primary - the
 * settings rail handles grouping).
 */
export function descriptorToModuleParam(d: SettingDescriptor): import('@wake-studio/contracts').ModuleParam {
  return {
    id: d.id as string,
    label: d.label,
    group: 'primary',
    // Keep select as select (module-kit renders UiSelect); boolean -> UiToggle;
    // secret -> password input; else string -> text input.
    type:
      d.type === 'boolean'
        ? 'boolean'
        : d.type === 'secret'
          ? 'secret'
          : d.type === 'select'
            ? 'select'
            : 'string',
    default: d.default,
    description: d.description,
    options: d.options,
  }
}
