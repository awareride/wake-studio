/**
 * Managed-backends storage (localStorage).
 *
 * Small, local-only list (same pattern as the platform settings store).
 * Backends are user-created endpoints; the token is stored here like the
 * Settings secrets — never sent to a WakeStudio server, never exported.
 */

import type { ManagedBackend } from './types'

export const BACKENDS_KEY = 'wake-backends'

export function loadBackends(): ManagedBackend[] {
  try {
    const raw = localStorage.getItem(BACKENDS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((b) => b && typeof b.id === 'string' && typeof b.baseUrl === 'string')
  } catch {
    return []
  }
}

export function saveBackends(backends: readonly ManagedBackend[]): void {
  localStorage.setItem(BACKENDS_KEY, JSON.stringify(backends))
}

export function upsertBackend(
  backends: readonly ManagedBackend[],
  backend: ManagedBackend,
): ManagedBackend[] {
  const exists = backends.some((b) => b.id === backend.id)
  const next = exists
    ? backends.map((b) => (b.id === backend.id ? backend : b))
    : [...backends, backend]
  saveBackends(next)
  return next
}

export function removeBackend(
  backends: readonly ManagedBackend[],
  id: string,
): ManagedBackend[] {
  const next = backends.filter((b) => b.id !== id)
  saveBackends(next)
  return next
}
