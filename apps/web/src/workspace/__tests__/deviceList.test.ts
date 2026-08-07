/**
 * Input-source device-list tests (epic #53 P2).
 *
 * Vitest runs in Node (no navigator.mediaDevices), so a minimal MediaDevices
 * mock is stubbed globally. Covers enumeration filtering, label detection,
 * devicechange subscription, and permission request.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  enumerateMicDevices,
  hasDeviceLabels,
  onDeviceChange,
  requestMicPermission,
} from '../sources/deviceList'
import type { MicDevice } from '../sources/deviceList'

type MediaDeviceInfoLike = {
  kind: string
  deviceId: string
  label: string
  groupId: string
}

function makeDevices(): MediaDeviceInfoLike[] {
  return [
    { kind: 'audioinput', deviceId: 'mic-1', label: 'Built-in Microphone', groupId: 'g1' },
    { kind: 'audioinput', deviceId: 'mic-2', label: 'USB Mic', groupId: 'g2' },
    { kind: 'audiooutput', deviceId: 'out-1', label: 'Speakers', groupId: 'g3' },
    { kind: 'videoinput', deviceId: 'cam-1', label: 'Camera', groupId: 'g4' },
  ]
}

/** Install a mock navigator.mediaDevices; returns a handle to mutate it. */
function stubMediaDevices(
  impl: Partial<typeof navigator.mediaDevices> = {},
): { listeners: Set<() => void>; stream: { getTracks: () => { stop: () => unknown }[] } } {
  const listeners = new Set<() => void>()
  const tracks = [{ stop: vi.fn() }, { stop: vi.fn() }]
  const stream = { getTracks: () => tracks }
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      mediaDevices: {
        enumerateDevices: vi.fn(async () => makeDevices()),
        getUserMedia: vi.fn(async () => stream),
        addEventListener: vi.fn((_: string, cb: () => void) => listeners.add(cb)),
        removeEventListener: vi.fn((_: string, cb: () => void) => listeners.delete(cb)),
        ...impl,
      },
    },
  })
  return { listeners, stream }
}

describe('enumerateMicDevices', () => {
  beforeEach(() => {
    delete (globalThis as { navigator?: unknown }).navigator
  })
  afterEach(() => {
    vi.restoreAllMocks()
    delete (globalThis as { navigator?: unknown }).navigator
  })

  it('filters to audioinput devices only', async () => {
    stubMediaDevices()
    const mics = await enumerateMicDevices()
    expect(mics).toHaveLength(2)
    expect(mics[0].deviceId).toBe('mic-1')
    expect(mics[0].label).toBe('Built-in Microphone')
    expect(mics.every((m: MicDevice) => m.deviceId.startsWith('mic'))).toBe(true)
  })

  it('returns [] when MediaDevices is unavailable', async () => {
    // No navigator stub -> the guard inside enumerateMicDevices returns [].
    const mics = await enumerateMicDevices()
    expect(mics).toEqual([])
  })

  it('returns [] when enumerateDevices throws', async () => {
    stubMediaDevices({
      enumerateDevices: vi.fn(async () => {
        throw new Error('denied')
      }),
    })
    const mics = await enumerateMicDevices()
    expect(mics).toEqual([])
  })
})

describe('hasDeviceLabels', () => {
  it('true when any device has a label', () => {
    expect(
      hasDeviceLabels([{ deviceId: 'a', label: 'Mic', groupId: 'g' }]),
    ).toBe(true)
  })

  it('false when all labels are blank (permission not granted)', () => {
    expect(
      hasDeviceLabels([{ deviceId: 'a', label: '', groupId: 'g' }]),
    ).toBe(false)
  })
})

describe('onDeviceChange', () => {
  beforeEach(() => {
    delete (globalThis as { navigator?: unknown }).navigator
  })
  afterEach(() => {
    vi.restoreAllMocks()
    delete (globalThis as { navigator?: unknown }).navigator
  })

  it('fires the callback on devicechange and unsubscribes', async () => {
    const { listeners } = stubMediaDevices()
    const cb = vi.fn()
    const off = onDeviceChange(cb)
    expect(listeners.size).toBe(1)

    // Fire the registered listener.
    listeners.forEach((l) => l())
    expect(cb).toHaveBeenCalledTimes(1)

    off()
    expect(listeners.size).toBe(0)
  })

  it('is a no-op when MediaDevices is unavailable', () => {
    const off = onDeviceChange(() => {})
    off() // must not throw
  })
})

describe('requestMicPermission', () => {
  beforeEach(() => {
    delete (globalThis as { navigator?: unknown }).navigator
  })
  afterEach(() => {
    vi.restoreAllMocks()
    delete (globalThis as { navigator?: unknown }).navigator
  })

  it('requests getUserMedia and stops all tracks on success', async () => {
    const { stream } = stubMediaDevices()
    const granted = await requestMicPermission()
    expect(granted).toBe(true)
    for (const t of stream.getTracks()) {
      expect(t.stop).toHaveBeenCalled()
    }
  })

  it('returns false on denial', async () => {
    stubMediaDevices({
      getUserMedia: vi.fn(async () => {
        throw new DOMException('denied', 'NotAllowedError')
      }),
    })
    const granted = await requestMicPermission()
    expect(granted).toBe(false)
  })

  it('returns false when MediaDevices is unavailable', async () => {
    const granted = await requestMicPermission()
    expect(granted).toBe(false)
  })
})
