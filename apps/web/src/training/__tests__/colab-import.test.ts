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

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { ArtifactBundle } from '@wake-studio/module-training'
import { registerColabBundle } from '../colab-import'
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

  it('persists the model as a classifier and a train artifact', async () => {
    const result = await registerColabBundle(colabBundle())

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