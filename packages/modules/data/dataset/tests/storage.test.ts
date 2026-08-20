/**
 * Dataset module - storage plugin catalog tests (ADR-044 §5.3, #204).
 *
 * Covers: built-in catalog validity, authKey declarations (Settings "Cloud
 * storage"), url read-only, duplicate/missing-id rejection, lookup helpers.
 */

import { describe, it, expect } from 'vitest'
import {
  BUILTIN_STORAGE_BACKENDS,
  STORAGE_BACKEND_KINDS,
  validateStorageCatalog,
  storageBackendById,
  storageAuthKeys,
  type StorageCatalog,
} from '../core/storage'

describe('storage plugin catalog', () => {
  it('built-in catalog is valid', () => {
    const { ok, errors } = validateStorageCatalog({ backends: [...BUILTIN_STORAGE_BACKENDS] })
    expect(errors).toEqual([])
    expect(ok).toBe(true)
  })

  it('declares every built-in backend with its authKey', () => {
    const ids = BUILTIN_STORAGE_BACKENDS.map((b) => b.id)
    expect(ids).toEqual(['backend-disk', 'hf', 'r2', 'gdrive', 'url'])

    const byId = new Map(BUILTIN_STORAGE_BACKENDS.map((b) => [b.id, b]))
    // backend-disk (local, no creds) + url (read-only, no creds)
    expect(byId.get('backend-disk')?.authKey).toBeNull()
    expect(byId.get('url')?.authKey).toBeNull()
    expect(byId.get('url')?.capabilities).toEqual(['pull'])
    // cloud backends point at Settings "Cloud storage" keys
    expect(byId.get('hf')?.authKey).toBe('cloud.hf')
    expect(byId.get('r2')?.authKey).toBe('cloud.r2')
    expect(byId.get('gdrive')?.authKey).toBe('cloud.gdrive')
  })

  it('all kinds are known', () => {
    for (const b of BUILTIN_STORAGE_BACKENDS) {
      expect(STORAGE_BACKEND_KINDS).toContain(b.kind)
    }
  })

  it('rejects duplicates and missing ids', () => {
    const bad: StorageCatalog = {
      backends: [
        { id: 'x', kind: 'local', authKey: null, capabilities: ['push'], format: 'zip' },
        { id: 'x', kind: 'local', authKey: null, capabilities: ['pull'], format: 'zip' },
        { id: '', kind: 'local', authKey: null, capabilities: ['push'], format: 'zip' },
      ],
    }
    const { ok, errors } = validateStorageCatalog(bad)
    expect(ok).toBe(false)
    expect(errors.some((e) => e.includes('duplicate storage backend id: x'))).toBe(true)
    expect(errors.some((e) => e.includes('without id'))).toBe(true)
  })

  it('rejects unknown capability/kind/format', () => {
    const bad: StorageCatalog = {
      backends: [
        { id: 'y', kind: 'huggingface', authKey: 'cloud.hf', capabilities: ['fly'], format: 'zip' },
      ],
    }
    const { ok, errors } = validateStorageCatalog(bad)
    expect(ok).toBe(false)
    expect(errors.some((e) => e.includes('invalid capability'))).toBe(true)
  })

  it('looks up by id and collects authKeys', () => {
    const catalog: StorageCatalog = { backends: [...BUILTIN_STORAGE_BACKENDS] }
    expect(storageBackendById(catalog, 'r2')?.kind).toBe('s3-compatible')
    expect(storageBackendById(catalog, 'nope')).toBeUndefined()
    expect(storageAuthKeys(catalog)).toEqual(['cloud.hf', 'cloud.r2', 'cloud.gdrive'])
  })
})
