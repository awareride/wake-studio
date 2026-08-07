/**
 * Settings - public exports (issue #52).
 */

export {
  PLATFORM_DEFAULTS,
  PLATFORM_SETTING_DESCRIPTORS,
  PLATFORM_SETTING_IDS,
  SETTINGS_SCHEMA_VERSION,
  descriptorToModuleParam,
  isSecretSetting,
  settingGroupOf,
} from './schema'
export type { SettingDescriptor } from './types'
export {
  buildExportPayload,
  getModuleSettings,
  KWS_SOURCES_KEY,
  loadKwsSources,
  loadModuleSettings,
  loadPlatformSettings,
  mergeModuleDefaults,
  mergePlatformDefaults,
  parseImportPayload,
  resetSettings,
  saveKwsSources,
  saveModuleSettings,
  savePlatformSettings,
  SETTINGS_STORAGE_KEYS,
} from './storage'
export type { KwsSourcesSettings } from './storage'
export type {
  AppLocale,
  AppSettings,
  DataRetention,
  ExecutionProvider,
  ModuleSettings,
  PlatformSettingId,
  PlatformSettings,
  ThemeMode,
} from './types'
export {
  SettingsProvider,
  applyTheme,
  resolveSystemTheme,
  useAppSettings,
} from './context'
export { ModuleSettingsSection } from './ModuleSettings'
