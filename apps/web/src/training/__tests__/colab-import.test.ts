/**
 * Colab import registration tests (issue #97).
 *
 * The zip→bundle validation is covered by the training module's L1 suite
 * (packages/modules/training/tests/manifest.test.ts). These tests cover the
 * app-side glue: after a valid bundle, `registerColabBundle` persists the
 * model into the user library (role 'classifier') and a `train` artifact
 * (ADR-033) carrying the provenance, and returns the model-source reference
 * the KWS panel uses for in-browser test.
 *
 * IndexedDB is shimmed with an in-memory store (same pattern as
 * src/model-library/__tests__/store.test.ts).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { ArtifactBundle } from '@wake-studio/module-training'
import { registerColabBundle, pullAndImportBundle } from '../colab-import'
import { listUserModels, listProvisionArtifacts } from '../../model-library'

// ---------------------------------------------------------------------------
// Minimal in-memory IndexedDB shim (objectStore.put/get/getAll/delete).
// ---------------------------------------------------------------------------

class MemoryObjectStore {
  private map = new Map<string, unknown>()

  private req<T>(result: T) {
    let onsuccess: (() => void) | null = null
    const r = {
      get result() {
        return result
      },
      set onsuccess(cb: (() => void) | null) {
        onsuccess = cb
        cb?.()
      },
      get onsuccess() {
        return onsuccess
      },
      onerror: null as (() => void) | null,
    }
    return r
  }

  put(v: { id: string }) {
    this.map.set(v.id, v)
    return this.req(v.id)
  }

  get(id: string) {
    return this.req(this.map.get(id))
  }

  getAll() {
    return this.req([...this.map.values()])
  }

  delete(id: string) {
    this.map.delete(id)
    return this.req(undefined)
  }
}

function installShim() {
  const store = new MemoryObjectStore()
  const db = {
    transaction: () => ({ objectStore: () => store }),
    objectStoreNames: { contains: () => true },
  } as unknown as IDBDatabase
  const req = { onsuccess: null as (() => void) | null, result: db }
  // Fire onsuccess synchronously when the caller attaches a handler.
  const open = () => {
    const r = { ...req }
    Object.defineProperty(r, 'onsuccess', {
      set(cb: (() => void) | null) {
        cb?.()
      },
      get() {
        return null
      },
    })
    return r
  }
  ;(globalThis as Record<string, unknown>).indexedDB = { open }
}

function tearDownShim() {
  delete (globalThis as Record<string, unknown>).indexedDB
}

function colabBundle(): ArtifactBundle {
  return {
    jobId: 'kws-openwakeword-123',
    modelFormat: 'onnx',
    files: {
      model: new Uint8Array([1, 2, 3, 4]),
      metrics: { recall: 0.9, accuracy: 0.8 },
      metadata: {
        jobId: 'kws-openwakeword-123',
        moduleId: 'kws-openwakeword',
        backend: 'colab',
        provider: 'colab',
        params: { wakePhrase: 'hey studio' },
        trainedAtMs: 42,
      },
      provenance: {
        license: 'user-owned',
        notes: 'Trained from synthetic TTS audio.',
      },
      configSnapshot: { target: 'app-class' },
    },
  }
}

describe('registerColabBundle (issue #97)', () => {
  beforeEach(() => installShim())
  afterEach(() => tearDownShim())

  it('persists the model as a classifier and a train artifact', async () => {    const result = await registerColabBundle(colabBundle())

    // The model lands in the user model library under the classifier role.
    const models = await listUserModels()
    expect(models).toHaveLength(1)
    expect(models[0]).toMatchObject({ role: 'classifier', format: 'onnx' })
    expect(result.model.id).toBe(models[0].id)

    // A train provisioning artifact (ADR-033) carries the bundle metadata.
    const artifacts = await listProvisionArtifacts()
    expect(artifacts).toHaveLength(1)
    expect(artifacts[0].kind).toBe('artifact')
    expect(artifacts[0].artifactType).toBe('train')
    expect(artifacts[0].backendId).toBe('kws-openwakeword')
    expect(artifacts[0].artifact.kind).toBe('train')
    if (artifacts[0].artifact.kind === 'train') {
      expect(artifacts[0].artifact.payload.urls.classifier).toBe(`user:${result.model.id}`)
    }
    // Provenance rides in the artifact notes (Phase 4 export gate input).
    expect(artifacts[0].notes).toContain('user-owned')
  })

  it('returns the classifier model-source reference for the KWS panel', async () => {
    const result = await registerColabBundle(colabBundle())
    expect(result.classifierRef).toBe(`user:${result.model.id}`)
    expect(result.bundle.files.provenance.license).toBe('user-owned')
    expect(result.bundle.files.metrics?.accuracy).toBe(0.8)
  })
})

// ---------------------------------------------------------------------------
// pullAndImportBundle — auto-pull + import of a tracked job's results (issue
// #159): fetch the zip from the backend artifact endpoint, parse it with the
// single bundle importer (real parser, not mocked), and register the model.
// ---------------------------------------------------------------------------

/** A minimal standard bundle zip (backend 'self-hosted'), base64-encoded.
 *  Generated by the training module's bundle layout — small enough to embed. */
const STREAMING_ZIP_B64 =
  'UEsDBBQAAAAAAKZ6El2dT9pzEQAAABEAAAAcAAAAa3dzLXN0cmVhbWluZy0xL21vZGVsLnRmbGl0ZWZha2UtdGZsaXRlLWJ5dGVzUEsDBBQAAAAAAKZ6El3vSZo4tQAAALUAAAAdAAAAa3dzLXN0cmVhbWluZy0xL21ldGFkYXRhLmpzb257ImpvYklkIjoia3dzLXN0cmVhbWluZy0xIiwibW9kdWxlSWQiOiJrd3Mtc3RyZWFtaW5nIiwiYmFja2VuZCI6InNlbGYtaG9zdGVkIiwicHJvdmlkZXIiOiJzZWxmLWhvc3RlZCIsInBhcmFtcyI6eyJ3YWtlUGhyYXNlcyI6ImhleSBzdHVkaW8iLCJtb2RlbCI6ImRzX3RjX3Jlc25ldCJ9LCJ0cmFpbmVkQXRNcyI6NDJ9UEsDBBQAAAAAAKZ6El0Bw1jTKgAAACoAAAAfAAAAa3dzLXN0cmVhbWluZy0xL3Byb3ZlbmFuY2UuanNvbnsibGljZW5zZSI6InVzZXItb3duZWQiLCJub3RlcyI6ImZpeHR1cmUifVBLAwQUAAAAAACmehJdI+2dFjAAAAAwAAAAHAAAAGt3cy1zdHJlYW1pbmctMS9tZXRyaWNzLmpzb257InJlY2FsbCI6MC45MSwic3RyZWFtaW5nX2FjY3VyYWN5X3Jlc2V0MCI6ODMuM31QSwMEFAAAAAAApnoSXcMZZKEYAAAAGAAAABsAAABrd3Mtc3RyZWFtaW5nLTEvY29uZmlnLmpzb257Im1vZGVsIjoiZHNfdGNfcmVzbmV0In1QSwECFAAUAAAAAACmehJdnU/acxEAAAARAAAAHAAAAAAAAAAAAAAAAAAAAAAAa3dzLXN0cmVhbWluZy0xL21vZGVsLnRmbGl0ZVBLAQIUABQAAAAAAKZ6El3vSZo4tQAAALUAAAAdAAAAAAAAAAAAAAAAAEsAAABrd3Mtc3RyZWFtaW5nLTEvbWV0YWRhdGEuanNvblBLAQIUABQAAAAAAKZ6El0Bw1jTKgAAACoAAAAfAAAAAAAAAAAAAAAAADsBAABrd3Mtc3RyZWFtaW5nLTEvcHJvdmVuYW5jZS5qc29uUEsBAhQAFAAAAAAApnoSXSPtnRYwAAAAMAAAABwAAAAAAAAAAAAAAAAAogEAAGt3cy1zdHJlYW1pbmctMS9tZXRyaWNzLmpzb25QSwECFAAUAAAAAACmehJdwxlkoRgAAAAYAAAAGwAAAAAAAAAAAAAAAAAMAgAAa3dzLXN0cmVhbWluZy0xL2NvbmZpZy5qc29uUEsFBgAAAAAFAAUAdQEAAF0CAAAAAA=='

function zipBytes(): Uint8Array {
  const bin = atob(STREAMING_ZIP_B64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

function zipResponse(status = 200): Response {
  return new Response(zipBytes(), {
    status,
    headers: { 'Content-Type': 'application/zip' },
  })
}

describe('pullAndImportBundle (auto pull + import, issue #159)', () => {
  beforeEach(() => installShim())
  afterEach(() => {
    tearDownShim()
    vi.unstubAllGlobals()
  })

  it('fetches the artifact URL, parses the bundle and registers the model', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(zipResponse()))

    const result = await pullAndImportBundle(
      'https://backend/artifacts/train-1/wake-studio-results.zip',
    )

    expect(fetch).toHaveBeenCalledWith(
      'https://backend/artifacts/train-1/wake-studio-results.zip',
    )
    // The studio-backend bundle (backend: self-hosted) imports cleanly.
    expect(result.bundle.files.metadata.backend).toBe('self-hosted')
    expect(result.bundle.jobId).toBe('kws-streaming-1')
    // Model + train artifact land in the user library (the IndexedDB shim
    // accumulates across the file, so assert on THIS model's presence).
    const models = await listUserModels()
    const imported = models.find((m) => m.id === result.model.id)
    expect(imported).toBeDefined()
    expect(imported?.role).toBe('classifier')
    const artifacts = await listProvisionArtifacts()
    expect(artifacts.some((a) => a.id === result.artifact.id)).toBe(true)
    expect(result.classifierRef).toBe(`user:${result.model.id}`)
  })

  it('throws a clear error when the artifact fetch returns an error status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(zipResponse(500)))

    await expect(
      pullAndImportBundle('https://backend/artifacts/train-1/wake-studio-results.zip'),
    ).rejects.toThrow('Pulling the artifact failed (HTTP 500).')
  })

  it('throws a clear error when the backend is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))

    await expect(
      pullAndImportBundle('https://backend/artifacts/train-1/wake-studio-results.zip'),
    ).rejects.toThrow(/Could not reach the backend/)
  })
})