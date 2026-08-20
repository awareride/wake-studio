/**
 * Settings storage tests (issue #52).
 *
 * Vitest runs in Node (no localStorage), so a minimal in-memory localStorage
 * shim is stubbed globally - same pattern as projects/__tests__/store.test.ts.
 * Covers: defaults merge, versioned round-trip, module settings map, KWS
 * sources layer, export masking, import parsing, reset.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  PLATFORM_DEFAULTS,
  PLATFORM_SETTING_IDS,
  isSecretSetting,
} from '../schema'
import {
  buildExportPayload,
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
  KWS_SOURCES_KEY,
} from '../storage'
import type { ThemeMode } from '../types'

// ---------------------------------------------------------------------------
// Minimal in-memory localStorage shim.
// ---------------------------------------------------------------------------

function makeLocalStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => {
      map.delete(k)
    },
    setItem: (k: string, v: string) => {
      map.set(k, String(v))
    },
  } as Storage
}

let shim: Storage

beforeEach(() => {
  shim = makeLocalStorage()
  vi.stubGlobal('localStorage', shim)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
// Platform settings
// ---------------------------------------------------------------------------

describe('platform settings', () => {
  it('loads defaults when nothing is stored', () => {
    expect(loadPlatformSettings()).toEqual(PLATFORM_DEFAULTS)
  })

  it('round-trips a full settings object', () => {
    const custom = {
      ...PLATFORM_DEFAULTS,
      theme: 'dark' as ThemeMode,
      'data.upload': true,
    }
    savePlatformSettings(custom)
    expect(loadPlatformSettings()).toEqual(custom)
  })

  it('merges partial/older payloads over defaults without crashing', () => {
    // Simulate an older payload missing newer keys + containing unknown keys.
    localStorage.setItem(
      SETTINGS_STORAGE_KEYS.platform,
      JSON.stringify({ theme: 'dark', bogusKey: 1 }),
    )
    const loaded = loadPlatformSettings()
    expect(loaded.theme).toBe('dark')
    expect(loaded.locale).toBe(PLATFORM_DEFAULTS.locale)
    expect('bogusKey' in loaded).toBe(false)
  })

  it('falls back to defaults on corrupt JSON', () => {
    localStorage.setItem(SETTINGS_STORAGE_KEYS.platform, '{not json')
    expect(loadPlatformSettings()).toEqual(PLATFORM_DEFAULTS)
  })

  it('mergePlatformDefaults drops unknown keys and fills missing', () => {
    const merged = mergePlatformDefaults({
      theme: 'system',
      junk: 'x',
    } as unknown as Parameters<typeof mergePlatformDefaults>[0])
    expect(merged.theme).toBe('system')
    expect((merged as unknown as Record<string, unknown>).junk).toBeUndefined()
    expect(merged['kws.executionProvider']).toBe(PLATFORM_DEFAULTS['kws.executionProvider'])
  })
})

// ---------------------------------------------------------------------------
// Module settings
// ---------------------------------------------------------------------------

describe('module settings', () => {
  it('round-trips per-backend values', () => {
    saveModuleSettings('sherpa-onnx-kws', { keywords: 'a b @c' })
    expect(loadModuleSettings()['sherpa-onnx-kws']).toEqual({
      keywords: 'a b @c',
    })
  })

  it('keeps multiple backends independent', () => {
    saveModuleSettings('sherpa-onnx-kws', { keywords: 'x' })
    saveModuleSettings('plixkws', { encoder: 'base' })
    const all = loadModuleSettings()
    expect(all['sherpa-onnx-kws']).toEqual({ keywords: 'x' })
    expect(all['plixkws']).toEqual({ encoder: 'base' })
  })

  it('mergeModuleDefaults layers stored values over spec defaults', () => {
    const merged = mergeModuleDefaults({ encoder: 'base' }, {
      encoder: 'small',
      runtime: 'onnx',
    })
    expect(merged).toEqual({ encoder: 'base', runtime: 'onnx' })
  })

  it('returns {} on missing/corrupt storage', () => {
    expect(loadModuleSettings()).toEqual({})
    localStorage.setItem(SETTINGS_STORAGE_KEYS.module, 'nope')
    expect(loadModuleSettings()).toEqual({})
  })
})

// ---------------------------------------------------------------------------
// KWS sources layer (#52/#53)
// ---------------------------------------------------------------------------

describe('kws sources', () => {
  it('round-trips modelSources + customUrls', () => {
    saveKwsSources({
      modelSources: { melspectrogram: 'hey-buddy' },
      customUrls: { 'plix-encoder': '/x.onnx' },
    })
    const loaded = loadKwsSources()
    expect(loaded.modelSources.melspectrogram).toBe('hey-buddy')
    expect(loaded.customUrls['plix-encoder']).toBe('/x.onnx')
  })

  it('defaults to empty maps when nothing stored', () => {
    expect(loadKwsSources()).toEqual({ modelSources: {}, customUrls: {} })
  })

  it('lives under the reserved KWS_SOURCES_KEY in the module map', () => {
    saveKwsSources({ modelSources: { classifier: 'hey-buddy' }, customUrls: {} })
    expect(loadModuleSettings()[KWS_SOURCES_KEY]).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// Export / import / reset
// ---------------------------------------------------------------------------

describe('export/import/reset', () => {
  it('masks secret values in exports', () => {
    const platform = {
      ...PLATFORM_DEFAULTS,
      'backend.apiKey': 'sk-123',
      'backend.secret': 'sec-456',
    }
    const payload = buildExportPayload(platform, {}, true)
    expect(payload.platform['backend.apiKey']).toBe('••••••••')
    expect(payload.platform['backend.secret']).toBe('••••••••')
    // Non-secrets pass through.
    expect(payload.platform.theme).toBe(platform.theme)
  })

  it('keeps real values when maskSecrets=false', () => {
    const platform = { ...PLATFORM_DEFAULTS, 'backend.apiKey': 'sk-123' }
    const payload = buildExportPayload(platform, {}, false)
    expect(payload.platform['backend.apiKey']).toBe('sk-123')
  })

  it('empty secrets are not masked (stay empty)', () => {
    const payload = buildExportPayload(PLATFORM_DEFAULTS, {}, true)
    expect(payload.platform['backend.apiKey']).toBe('')
  })

  it('parseImportPayload merges over defaults and keeps module map', () => {
    const raw = JSON.stringify({
      platform: { theme: 'dark' },
      module: { plixkws: { encoder: 'base' } },
    })
    const parsed = parseImportPayload(raw)
    expect(parsed.platform.theme).toBe('dark')
    expect(parsed.platform.locale).toBe(PLATFORM_DEFAULTS.locale)
    expect(parsed.module.plixkws).toEqual({ encoder: 'base' })
  })

  it('reset clears both storage keys', () => {
    savePlatformSettings({ ...PLATFORM_DEFAULTS, theme: 'dark' as ThemeMode })
    saveModuleSettings('sherpa-onnx-kws', { keywords: 'x' })
    resetSettings()
    expect(loadPlatformSettings()).toEqual(PLATFORM_DEFAULTS)
    expect(loadModuleSettings()).toEqual({})
  })

  it('descriptor schema covers every id with a secret flag', () => {
    // Every id has exactly one descriptor; secrets are the backend credentials.
    for (const id of PLATFORM_SETTING_IDS) {
      expect(typeof isSecretSetting(id)).toBe('boolean')
    }
    expect(isSecretSetting('backend.apiKey')).toBe(true)
    expect(isSecretSetting('backend.secret')).toBe(true)
    expect(isSecretSetting('theme')).toBe(false)
  })

  it('cloud storage group: descriptors exist + secrets are masked on export (#204)', () => {
    const cloudIds = PLATFORM_SETTING_IDS.filter((id) => id.startsWith('cloud.'))
    expect(cloudIds.sort()).toEqual([
      'cloud.gdrive.clientId',
      'cloud.gdrive.clientSecret',
      'cloud.hf.token',
      'cloud.r2.accessKeyId',
      'cloud.r2.bucket',
      'cloud.r2.endpoint',
      'cloud.r2.secretAccessKey',
    ])
    // secret-typed cloud fields are masked on export
    expect(isSecretSetting('cloud.hf.token')).toBe(true)
    expect(isSecretSetting('cloud.r2.secretAccessKey')).toBe(true)
    expect(isSecretSetting('cloud.gdrive.clientSecret')).toBe(true)
    // non-secret endpoint/bucket/clientId pass through unmasked
    const platform = {
      ...PLATFORM_DEFAULTS,
      'cloud.hf.token': 'hf_secret',
      'cloud.r2.endpoint': 'https://x.r2.cloudflarestorage.com',
    }
    const payload = buildExportPayload(platform, {}, true)
    expect(payload.platform['cloud.hf.token']).toBe('••••••••')
    expect(payload.platform['cloud.r2.endpoint']).toBe('https://x.r2.cloudflarestorage.com')
  })
})
