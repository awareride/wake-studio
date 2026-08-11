/**
 * kws-streaming driver module - registry integration (L1, ADR-026).
 *
 * These guard the seams that made the driver invisible at runtime even though
 * every unit test passed:
 *   - the worker decides whether to load a backend from `hasRequiredUrls`, so a
 *     driver that does not declare it is silently skipped (ready-but-deaf);
 *   - registration must carry the right category/spec so the panel renders.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import {
  backendHasRequiredUrls,
  getBackendRegistration,
} from '@wake-studio/module-kws-engine'
import type { BackendModelUrls } from '@wake-studio/module-kws-engine'

describe('kws-streaming registry integration', () => {
  beforeAll(async () => {
    // Import for its registration side-effect (ADR-024 decoupling seam).
    await import('../core/index')
  })

  it('registers itself as a traditional backend', () => {
    const reg = getBackendRegistration('kws-streaming')
    expect(reg).toBeDefined()
    expect(reg?.category).toBe('traditional')
    expect(reg?.browserFeasible).toBe(true)
    expect(reg?.spec?.meta.id).toBe('kws-streaming')
  })

  it('runs in the worker (declares no main-thread factory)', () => {
    // Unlike sherpa, this driver is plain onnxruntime-web with no DOM need.
    expect(getBackendRegistration('kws-streaming')?.mainThreadFactory).toBeUndefined()
  })

  it('declares its OWN url requirement (model + manifest), not the owww triple', () => {
    const paired: BackendModelUrls = {
      kwsStreaming: { model: 'm.onnx', manifest: 'm.json' },
    }
    expect(backendHasRequiredUrls('kws-streaming', paired)).toBe(true)

    // The openwakeword triple must NOT satisfy this backend...
    expect(
      backendHasRequiredUrls('kws-streaming', {
        melspectrogram: 'a',
        embedding: 'b',
        classifier: 'c',
      }),
    ).toBe(false)
    // ...and a half-configured pair must not either: loading a graph without
    // its manifest cannot work, and loading it anyway would fail deep inside
    // inference instead of at load time.
    expect(
      backendHasRequiredUrls('kws-streaming', {
        kwsStreaming: { model: 'm.onnx', manifest: '' },
      }),
    ).toBe(false)
    expect(backendHasRequiredUrls('kws-streaming', {})).toBe(false)
  })

  it('keeps the openwakeword default for drivers without the capability', () => {
    // Regression guard: adding hasRequiredUrls must not change existing drivers.
    expect(
      backendHasRequiredUrls('openwakeword', {
        melspectrogram: 'a',
        embedding: 'b',
        classifier: 'c',
      }),
    ).toBe(true)
    expect(backendHasRequiredUrls('openwakeword', { melspectrogram: 'a' })).toBe(false)
  })

  it('creates a backend instance with the expected id', () => {
    const backend = getBackendRegistration('kws-streaming')!.create()
    expect(backend.id).toBe('kws-streaming')
    expect(backend.ready).toBe(false)
  })
})
