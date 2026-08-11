/**
 * User model library store tests.
 *
 * The store wraps IndexedDB. Vitest runs in Node (no indexedDB), so these
 * tests exercise the pure pieces and mock the IDB adapter through a minimal
 * in-memory shim (same pattern as src/projects/__tests__/store.test.ts). The
 * browser path (file import -> saved model -> load) is covered by the e2e
 * model-source-ui.spec.ts.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

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
  } as unknown as IDBDatabase
  const req = { onsuccess: null as (() => void) | null, result: db }
  // Fire onsuccess synchronously when the caller attaches a handler.
  const open = vi.fn(() => {
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
  })
  vi.stubGlobal('indexedDB', { open })
  return store
}

const FILE = new File(['fake-onnx-bytes'], 'classifier.onnx', {
  type: 'application/octet-stream',
})

// The store caches its IDB open promise at module level; reset the module
// registry before each test so a fresh shim instance is used.
let mod: typeof import('../store')

async function freshStore() {
  vi.resetModules()
  mod = await import('../store')
  return mod
}

describe('user model library store', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    installShim()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('imports a File into the library with metadata', async () => {
    const { importModelFile } = await freshStore()
    const model = await importModelFile(FILE, 'classifier')
    expect(model.name).toBe('classifier.onnx')
    expect(model.role).toBe('classifier')
    expect(model.format).toBe('onnx')
    expect(model.sizeBytes).toBe(FILE.size)
    expect(model.id).toMatch(/^model-/)
  })

  it('lists imported models newest-first', async () => {
    const { importModelFile, listUserModels } = await freshStore()
    await importModelFile(new File(['a'], 'a.onnx'), 'classifier')
    // Small delay so createdAtMs differs.
    await new Promise((r) => setTimeout(r, 2))
    await importModelFile(new File(['b'], 'b.onnx'), 'melspectrogram')
    const all = await listUserModels()
    expect(all).toHaveLength(2)
    expect(all[0].name).toBe('b.onnx')
    expect(all[1].name).toBe('a.onnx')
  })

  it('deletes a stored model', async () => {
    const { importModelFile, deleteUserModel, listUserModels } = await freshStore()
    const m = await importModelFile(FILE, 'classifier')
    await deleteUserModel(m.id)
    const all = await listUserModels()
    expect(all).toHaveLength(0)
  })

  it('stores provisioned artifacts alongside models (ADR-033)', async () => {
    const { importModelFile, saveProvisionArtifact, listProvisionArtifacts, listUserModels } =
      await freshStore()
    await importModelFile(FILE, 'classifier')
    const saved = await saveProvisionArtifact(
      {
        kind: 'prototype',
        backendId: 'plixkws',
        payload: {
          id: 'p1',
          word: 'hey-buddy',
          vector: [1, 2, 3],
          sampleIds: ['s1', 's2'],
          createdAtMs: Date.now(),
        },
      },
      { name: 'hey-buddy' },
    )
    expect(saved.kind).toBe('artifact')
    expect(saved.artifactType).toBe('prototype')
    expect(saved.id).toMatch(/^artifact-/)

    // One browsable collection: both the model and the artifact are listed.
    const artifacts = await listProvisionArtifacts()
    expect(artifacts).toHaveLength(1)
    expect(artifacts[0].artifact.kind).toBe('prototype')
    // Models are not artifacts (and legacy entries without kind are models).
    expect(await listUserModels()).toHaveLength(1)
  })

  it('deletes a provisioned artifact', async () => {
    const { saveProvisionArtifact, deleteProvisionArtifact, listProvisionArtifacts } =
      await freshStore()
    const saved = await saveProvisionArtifact(
      { kind: 'list', backendId: 'sherpa-onnx-kws', payload: { keywords: 'x iǎo ài tóng xué @test' } },
      { name: 'test-keywords' },
    )
    await deleteProvisionArtifact(saved.id)
    expect(await listProvisionArtifacts()).toHaveLength(0)
  })
})
