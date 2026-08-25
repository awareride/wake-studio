/**
 * Datasets — browser-local store (ADR-045 #220): metadata-only IndexedDB +
 * OPFS file bytes.
 *
 * The real `local-store.ts` runs against a fake IndexedDB (fake-idb.ts) and a
 * fake OPFS root (fake-opfs.ts, injected by mocking `getDatasetRoot`). This
 * pins the new contract: records carry a `storage` ref and NO file bytes;
 * bytes round-trip through OPFS; uploads patch metadata only; pre-#220
 * records (zip bytes in IndexedDB) migrate lazily on first list.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildGeneratedManifest } from '@wake-studio/module-dataset'
import {
  deleteLocalDataset,
  getLocalDataset,
  getLocalDatasetZip,
  listLocalDatasets,
  patchLocalDatasetManifest,
  saveLocalDataset,
} from '../local-store'
import { setOpfsRootProvider } from '../browser/opfs-dataset'
import { makeFakeOpfsRoot } from './fake-opfs'
import { installFakeIndexedDB, type FakeIdbBackingStore } from './fake-idb'

const hoisted = vi.hoisted(() => ({
  root: null as unknown as FileSystemDirectoryHandle,
}))

vi.mock('../browser/opfs-dataset', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../browser/opfs-dataset')>()
  // The OPFS gate is off in Node (no navigator) — tests flip it on so the real
  // store code runs against the fake OPFS root (injected via setOpfsRootProvider).
  return {
    ...actual,
    isOpfsAvailable: () => true,
  }
})

const STORE_NAME = 'local-datasets'
const zipBytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])

function makeManifest(id: string, name: string) {
  return buildGeneratedManifest(
    { engine: 'mimo-tts', phrases: ['hey'], languages: ['en-US'], samplesPerPhrase: 1, datasetId: id, name },
    [{ name: 'hey', role: 'positive' }],
    1,
    9,
  )
}

describe('local-store (ADR-045 metadata-only contract)', () => {
  let backing: FakeIdbBackingStore

  // ONE fake IndexedDB install for the whole file: local-store caches its
  // openDb() promise, so reinstalling per-test would orphan later tests on a
  // stale store. Clear the shared record map between tests instead.
  beforeAll(() => {
    backing = installFakeIndexedDB(STORE_NAME)
  })

  beforeEach(() => {
    backing.records.clear()
    hoisted.root = makeFakeOpfsRoot() as unknown as FileSystemDirectoryHandle
    setOpfsRootProvider(async () => hoisted.root)
  })

  it('stores METADATA ONLY in IndexedDB (no zip bytes) and bytes in OPFS', async () => {
    const manifest = makeManifest('ds-1', 'One')
    const summary = await saveLocalDataset(manifest, zipBytes)

    expect(summary).toMatchObject({ id: 'ds-1', sizeBytes: zipBytes.byteLength })

    const record = await getLocalDataset('ds-1')
    expect(record).toBeDefined()
    expect(record!.storage).toEqual({ kind: 'opfs', format: 'zip' })
    expect('zipBytes' in record!).toBe(false) // the new contract: no bytes in IDB

    // Bytes are readable from OPFS.
    expect([...(await getLocalDatasetZip('ds-1'))!]).toEqual([...zipBytes])
  })

  it('lists metadata-only summaries after save', async () => {
    await saveLocalDataset(makeManifest('ds-1', 'One'), zipBytes)
    const all = await listLocalDatasets()
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({ id: 'ds-1', sizeBytes: 8 })
  })

  it('patches the manifest WITHOUT touching the OPFS bytes', async () => {
    await saveLocalDataset(makeManifest('ds-1', 'One'), zipBytes)
    const record = await getLocalDataset('ds-1')
    await patchLocalDatasetManifest('ds-1', {
      ...record!.manifest,
      storage: { backend: '', cloud: 'hf://u/ds' },
    })
    const patched = await getLocalDataset('ds-1')
    expect(patched?.manifest.storage?.cloud).toBe('hf://u/ds')
    expect([...(await getLocalDatasetZip('ds-1'))!]).toEqual([...zipBytes]) // bytes untouched
  })

  it('delete removes the OPFS bytes and the IndexedDB record', async () => {
    await saveLocalDataset(makeManifest('ds-1', 'One'), zipBytes)
    await deleteLocalDataset('ds-1')
    expect(await listLocalDatasets()).toEqual([])
    expect(await getLocalDatasetZip('ds-1')).toBeNull()
  })

  it('migrates a pre-#220 record (zip bytes in IDB → OPFS) on first list', async () => {
    const manifest = makeManifest('legacy-1', 'Legacy')
    backing.records.set('legacy-1', {
      id: 'legacy-1',
      manifest,
      zipBytes,
      sizeBytes: zipBytes.byteLength,
      savedAtMs: 42,
    })

    const all = await listLocalDatasets()
    expect(all).toHaveLength(1)
    expect(all[0].id).toBe('legacy-1')

    // Bytes landed in OPFS and the record no longer carries them.
    expect([...(await getLocalDatasetZip('legacy-1'))!]).toEqual([...zipBytes])
    const migrated = backing.records.get('legacy-1') as Record<string, unknown>
    expect(migrated.storage).toEqual({ kind: 'opfs', format: 'zip' })
    expect('zipBytes' in migrated).toBe(false)
  })
})