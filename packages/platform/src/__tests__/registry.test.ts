/**
 * Model registry + base-path unit tests.
 *
 * Covers the license gate (isCommerciallyUsable), the base-path resolver
 * (resolveAsset), and the reachability probe (HEAD against a mock fetch) -
 * moved from `apps/web/src/data/__tests__/registry.test.ts` (§6.1).
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import { isCommerciallyUsable, type RegistryModel } from '../registry'
import { resolveAsset, APP_BASE } from '../base-path'
import { probeModelUrl } from '../probe'

function model(partial: Partial<RegistryModel> = {}): RegistryModel {
  return {
    id: 'm',
    name: 'Model',
    tier: ['high-performance'],
    source: 'src',
    url: '/models/m.onnx',
    format: 'onnx',
    license: 'MIT',
    commercial: true,
    class: 'redistributable',
    sha256: null,
    sizeBytes: 100,
    ...partial,
  }
}

describe('isCommerciallyUsable (license gate)', () => {
  it('true for redistributable + commercial', () => {
    expect(isCommerciallyUsable(model())).toBe(true)
  })

  it('false when not explicitly commercial', () => {
    expect(isCommerciallyUsable(model({ commercial: false }))).toBe(false)
  })

  it('false when demo-only', () => {
    expect(isCommerciallyUsable(model({ class: 'demo-only' }))).toBe(false)
  })

  it('false when demo-only even if commercial flag set', () => {
    expect(
      isCommerciallyUsable(model({ class: 'demo-only', commercial: true })),
    ).toBe(false)
  })
})

describe('resolveAsset (base-path, ADR-012)', () => {
  it('passes absolute http(s) URLs through unchanged', () => {
    expect(resolveAsset('https://example.com/m.onnx')).toBe(
      'https://example.com/m.onnx',
    )
  })

  it('joins a root-relative path under the app base', () => {
    const base = APP_BASE.endsWith('/') ? APP_BASE : `${APP_BASE}/`
    expect(resolveAsset('/prebuilts/x.wasm')).toBe(`${base}prebuilts/x.wasm`)
  })

  it('keeps a path already under the base unchanged', () => {
    expect(resolveAsset(`${APP_BASE}model-registry.json`)).toBe(
      `${APP_BASE}model-registry.json`,
    )
  })
})

describe('probeModelUrl', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns ok with content-length on a successful HEAD', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: (k: string) => (k === 'content-length' ? '2048' : null) },
      }),
    )
    const r = await probeModelUrl('https://example.com/model.onnx')
    expect(r.state).toBe('ok')
    expect(r.sizeBytes).toBe(2048)
  })

  it('returns error state on HTTP failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 404, headers: { get: () => null } }),
    )
    const r = await probeModelUrl('https://example.com/missing')
    expect(r.state).toBe('error')
    expect(r.status).toBe(404)
  })

  it('returns error state on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    const r = await probeModelUrl('https://example.com/x')
    expect(r.state).toBe('error')
    expect(r.error).toBe('network down')
  })
})
