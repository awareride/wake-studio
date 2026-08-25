/**
 * Minimal in-memory IndexedDB for the #220 local-store tests.
 *
 * The local-store only uses `indexedDB.open` + one object store with
 * get/getAll/put/delete (keyed by `id`), so a ~40-line fake suffices — no
 * `fake-indexeddb` dependency needed. Install BEFORE exercising the store.
 */

export interface FakeIdbBackingStore {
  records: Map<string, unknown>
}

interface FakeIdbRequest<T> {
  result: T
  onsuccess: ((ev: Event) => void) | null
  onerror: ((ev: Event) => void) | null
  onupgradeneeded?: ((ev: Event) => void) | null
  error: Error | null
}

/** Replace `globalThis.indexedDB` with an in-memory implementation for one
 *  object store. Returns the backing store so tests can seed/migrate records. */
export function installFakeIndexedDB(storeName: string): FakeIdbBackingStore {
  const backing: FakeIdbBackingStore = { records: new Map() }

  const makeRequest = <T>(result: T): FakeIdbRequest<T> => {
    const req: FakeIdbRequest<T> = { result, onsuccess: null, onerror: null, error: null }
    queueMicrotask(() => req.onsuccess?.(new Event('success')))
    return req
  }

  const store = {
    get: (key: string) => makeRequest(backing.records.get(key)),
    getAll: () => makeRequest([...backing.records.values()]),
    put: (value: { id: string }) => {
      backing.records.set(value.id, value)
      return makeRequest(undefined)
    },
    delete: (key: string) => {
      backing.records.delete(key)
      return makeRequest(undefined)
    },
  }

  const db = {
    objectStoreNames: { contains: (name: string) => name === storeName },
    createObjectStore: () => undefined,
    transaction: () => ({ objectStore: () => store }),
  }

  ;(globalThis as unknown as { indexedDB: unknown }).indexedDB = {
    open: (_name: string, _version: number) => {
      const req = {
        result: db,
        onsuccess: null as ((ev: Event) => void) | null,
        onerror: null as ((ev: Event) => void) | null,
        onupgradeneeded: null as ((ev: Event) => void) | null,
        error: null,
      }
      queueMicrotask(() => {
        req.onupgradeneeded?.(new Event('upgradeneeded'))
        req.onsuccess?.(new Event('success'))
      })
      return req
    },
  } as unknown as IDBFactory

  return backing
}