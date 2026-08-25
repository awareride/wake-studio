/**
 * Datasets — consolidated store (ADR-044 §8.2, #208).
 *
 * ONE merged view over the three dataset sources the console (and, in #208's
 * actions, the Training `datasets[]` picker) read from:
 *
 *   1. **Built-ins** — the static catalog (`datasets.json`), immutable refs.
 *   2. **Backend store** — `GET /datasets` on a connected studio-backend
 *      (generated/uploaded datasets persisted server-side).
 *   3. **Browser-local** — IndexedDB datasets generated/imported client-side
 *      (no backend needed).
 *
 * The merge is a PURE function (`mergeDatasets`) so it is L1-testable; the
 * `useDatasetsStore` hook wires it to the real sources. Same-id datasets from
 * multiple origins collapse into one row (local > backend > builtin — the
 * row with the most capability wins).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  isBuiltinAvailable,
  type DatasetCatalogEntry,
  type DatasetKind,
  type DatasetManifest,
  type DatasetRole,
  type LabelRole,
} from '@wake-studio/module-dataset'
import { createStudioClient, type StoreDataset, type StudioClient } from '../training/studio-client'
import { fetchBuiltinDatasets } from './catalog'
import { listLocalDatasets, type LocalDatasetSummary } from './local-store'

/** Where a dataset lives (drives which actions are available). */
export type DatasetOrigin = 'builtin' | 'backend' | 'local'

/** One row in the Datasets console rail + details. */
export interface ConsoleDataset {
  id: string
  name: string
  version: number
  kind: DatasetKind
  role: DatasetRole
  clips: number
  /** Distinct semantic roles among the labels (positives/unknowns/noise). */
  roles: LabelRole[]
  /** First provenance license (the export-gate input). */
  license: string
  commercialUse: boolean
  /** false = a pending-host builtin (declared but not trainable yet, #207). */
  available: boolean
  note?: string
  manifest: DatasetManifest
  origin: DatasetOrigin
  sizeBytes?: number
  /** Optional cloud ref (storage.cloud, e.g. "hf://user/ds"). */
  cloud?: string
  createdAtMs?: number
}

/** Origin priority when the same dataset id exists in several sources:
 *  local (OPFS archive in hand) > backend (materialized + downloadable) >
 *  builtin (immutable reference). */
const ORIGIN_RANK: Record<DatasetOrigin, number> = {
  local: 2,
  backend: 1,
  builtin: 0,
}

export function fromBackendStore(d: StoreDataset): ConsoleDataset {
  const m = d.manifest as unknown as DatasetManifest
  return {
    id: d.id,
    name: d.name,
    version: d.version,
    kind: d.kind as DatasetKind,
    role: d.role as DatasetRole,
    clips: m.audio?.clips ?? 0,
    roles: [...new Set((m.labels ?? []).map((l) => l.role))],
    license: m.provenance?.[0]?.license ?? 'unknown',
    commercialUse: m.provenance?.[0]?.commercialUse ?? true,
    available: true,
    manifest: m,
    origin: 'backend',
    sizeBytes: d.sizeBytes,
    cloud: m.storage?.cloud,
    createdAtMs: d.createdAtMs,
  }
}

export function fromBuiltinCatalog(e: DatasetCatalogEntry): ConsoleDataset {
  const m = e as unknown as DatasetManifest
  return {
    id: e.id,
    name: e.name,
    version: e.version,
    kind: e.kind,
    role: e.role,
    clips: e.audio?.clips ?? 0,
    roles: [...new Set((e.labels ?? []).map((l) => l.role))],
    license: e.provenance?.[0]?.license ?? 'unknown',
    commercialUse: e.provenance?.[0]?.commercialUse ?? true,
    available: isBuiltinAvailable(e),
    note: e.materialize?.type === 'pending-host' ? e.materialize?.note : undefined,
    manifest: m,
    origin: 'builtin',
    cloud: m.storage?.cloud,
    createdAtMs: m.createdAtMs,
  }
}

export function fromLocal(l: LocalDatasetSummary): ConsoleDataset {
  const m = l.manifest
  return {
    id: l.id,
    name: m.name,
    version: m.version,
    kind: m.kind,
    role: m.role,
    clips: m.audio?.clips ?? 0,
    roles: [...new Set((m.labels ?? []).map((x) => x.role))],
    license: m.provenance?.[0]?.license ?? 'unknown',
    commercialUse: m.provenance?.[0]?.commercialUse ?? true,
    available: true,
    manifest: m,
    origin: 'local',
    sizeBytes: l.sizeBytes,
    cloud: m.storage?.cloud,
    createdAtMs: m.createdAtMs ?? l.savedAtMs,
  }
}

/** Merge the three sources into one list (pure — L1-testable). */
export function mergeDatasets(
  backend: StoreDataset[],
  builtins: DatasetCatalogEntry[],
  local: LocalDatasetSummary[],
): ConsoleDataset[] {
  const byId = new Map<string, ConsoleDataset>()
  const put = (d: ConsoleDataset) => {
    const existing = byId.get(d.id)
    if (!existing || ORIGIN_RANK[d.origin] > ORIGIN_RANK[existing.origin]) byId.set(d.id, d)
  }
  for (const d of backend) put(fromBackendStore(d))
  for (const e of builtins) put(fromBuiltinCatalog(e))
  for (const l of local) put(fromLocal(l))
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export interface DatasetsStoreState {
  datasets: ConsoleDataset[]
  builtinError: string | null
  backendError: string | null
  loading: boolean
  /** Studio-backend client (null when no managed backend is configured). */
  client: StudioClient | null
  refresh: () => Promise<void>
}

/**
 * Load the consolidated dataset list from all three sources. Mirrors the
 * Training console's backend-client selection: the first configured managed
 * backend (Backends menu) feeds `GET /datasets`; built-ins + the browser-local
 * store always load.
 */
export function useDatasetsStore(backendBaseUrl?: string, backendToken?: string): DatasetsStoreState {
  const client = useMemo<StudioClient | null>(
    () => (backendBaseUrl ? createStudioClient(backendBaseUrl, backendToken) : null),
    [backendBaseUrl, backendToken],
  )
  const [backend, setBackend] = useState<StoreDataset[] | null>(null)
  const [builtins, setBuiltins] = useState<DatasetCatalogEntry[]>([])
  const [builtinError, setBuiltinError] = useState<string | null>(null)
  const [backendError, setBackendError] = useState<string | null>(null)
  const [local, setLocal] = useState<LocalDatasetSummary[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    // Built-ins always load (static catalog).
    const { builtins: b, error } = await fetchBuiltinDatasets()
    setBuiltins(b)
    setBuiltinError(error)
    // Local store always loads (IndexedDB).
    try {
      setLocal(await listLocalDatasets())
    } catch (err) {
      setLocal([])
      void err
    }
    // Backend store only when a studio-backend is connected.
    if (client) {
      try {
        setBackend(await client.listDatasets())
        setBackendError(null)
      } catch (err) {
        setBackendError(err instanceof Error ? err.message : String(err))
        setBackend(null)
      }
    } else {
      setBackend(null)
      setBackendError(null)
    }
    setLoading(false)
  }, [client])

  useEffect(() => {
    let cancelled = false
    void refresh().then(() => {
      if (cancelled) return
    })
    return () => {
      cancelled = true
    }
  }, [refresh])

  const datasets = useMemo(
    () => mergeDatasets(backend ?? [], builtins, local),
    [backend, builtins, local],
  )

  return { datasets, builtinError, backendError, loading, client, refresh }
}
