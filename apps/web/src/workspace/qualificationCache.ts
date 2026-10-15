/**
 * Capture qualification cache (issue #246).
 *
 * The qualification verdict describes a *capture*, not a code path: it is
 * re-measured from the live audio whenever the pipeline runs, and it is
 * remembered here so the UI can tell the user what the last capture on this
 * device looked like **before** they press Start, instead of nothing at all.
 *
 * Two deliberate limits:
 *
 * - A cached verdict is a UI cache, never an authorization. While the pipeline
 *   is running, the live probe decides whether spatial processing may be
 *   enabled (docs/modules/afe.md §6.2); a stale cache entry is never consulted
 *   for that.
 * - The cache is keyed by what actually changes the answer: input device and
 *   requested channel count. Anything else (a browser restart, a new tab) does
 *   not change what the OS will deliver.
 */

import type { QualificationResult } from '@wake-studio/module-afe-graph'

const KEY_PREFIX = 'wake-studio:afe-qualification:'

/** What a cached verdict records, including how stale it is. */
export interface CachedQualification {
  level: QualificationResult['level']
  reasons: string[]
  /** Device id the verdict was measured on ('default' when unset). */
  deviceId: string
  /** Channel count the capture was opened with. */
  channelCount: number
  /** When it was measured (epoch ms), so the UI can show the age. */
  atMs: number
}

/** Signature of everything the verdict depends on. */
export function qualificationSignature(sig: {
  deviceId?: string
  channelCount?: number
}): string {
  return `${sig.deviceId ?? 'default'}:ch${sig.channelCount ?? 1}`
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    // Private mode / blocked storage: the cache is a convenience, never required.
    return null
  }
}

export function readCachedQualification(
  sig: { deviceId?: string; channelCount?: number },
): CachedQualification | null {
  const raw = storage()?.getItem(KEY_PREFIX + qualificationSignature(sig))
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as CachedQualification
    if (parsed.level !== 'qualified' && parsed.level !== 'degraded' && parsed.level !== 'unsupported') {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

/** Remember a verdict for one capture signature. */
export function writeCachedQualification(
  sig: { deviceId?: string; channelCount?: number },
  result: QualificationResult,
  atMs: number = Date.now(),
): void {
  try {
    storage()?.setItem(
      KEY_PREFIX + qualificationSignature(sig),
      JSON.stringify({
        level: result.level,
        reasons: result.reasons,
        deviceId: sig.deviceId ?? 'default',
        channelCount: sig.channelCount ?? 1,
        atMs,
      } satisfies CachedQualification),
    )
  } catch {
    // Storage full or blocked: a lost cache entry costs nothing.
  }
}

/** Drop every cached verdict (e.g. a "forget this device" action). */
export function clearCachedQualification(): void {
  const store = storage()
  if (!store) return
  // The Storage API (length + key(i)), not Object.keys: a store's entries are
  // not its own properties, and the conforming way also works with any
  // implementation of the interface.
  for (let i = store.length - 1; i >= 0; i--) {
    const key = store.key(i)
    if (key !== null && key.startsWith(KEY_PREFIX)) store.removeItem(key)
  }
}
