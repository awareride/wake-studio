/**
 * Training wizard — Dataset picker (issues #206 + #207).
 *
 * Replaces the `dataSource` source-selector with a `datasets[]` picker fed
 * from two sources:
 *
 * 1. **Built-ins** — the static catalog (`apps/web/public/datasets.json`,
 *    ADR-044 §7): immutable references (`kind: builtin`), materialized on
 *    first use by the backend. `pending-host` entries are shown but disabled.
 * 2. **The backend Datasets store** (GET /datasets, ADR-044 #204): generated /
 *    uploaded datasets.
 *
 * The picker validates the combined selection against the module's
 * `spec.train.dataset` requirements (core/materialize.ts
 * `validateDatasetRequirements`) so the user gets clear warnings instead of a
 * cryptic trainer crash. The picked ids are comma-joined into the `datasets`
 * train param, which flows through the registry (`STREAM_DATASETS` /
 * `WAKE_DATASETS`) to the adapter's load-refs → materialize → merge (ADR-031).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  isBuiltinAvailable,
  validateDatasetCatalog,
  validateDatasetRequirements,
  type DatasetCatalogEntry,
  type DatasetManifest,
  type TrainerDatasetRequirements,
} from '@wake-studio/module-dataset'
import { resolveAsset } from '@wake-studio/platform'
import { cn } from '../../components/cn'
import type { StoreDataset, StudioClient } from '../studio-client'

export interface DatasetPickerProps {
  /** The studio-backend client whose /datasets store feeds the picker. */
  client: StudioClient | null
  /** The module's spec.train.dataset requirements (what we validate against). */
  requirements: TrainerDatasetRequirements | undefined
  /** Comma-joined selected dataset ids (the `datasets` train param). */
  value: string
  onChange: (value: string) => void
}

const KIND_LABEL: Record<string, string> = {
  builtin: 'Built-in',
  generated: 'Generated',
  uploaded: 'Uploaded',
  public: 'Public',
}

const ROLE_LABEL: Record<string, string> = {
  positive: 'positives',
  unknowns: 'unknowns',
  noise: 'noise',
  mixed: 'mixed',
}

/** One selectable row — a store dataset or a built-in, in a common shape. */
interface PickableDataset {
  id: string
  name: string
  version: number
  kind: string
  role: string
  clips: number
  roles: string[]
  license: string
  commercialUse: boolean
  /** false = pending-host builtin (declared but not trainable yet, #207). */
  available: boolean
  note?: string
  /** The manifest the requirements validation reads. */
  manifest: DatasetManifest
}

function fromStore(d: StoreDataset): PickableDataset {
  const m = d.manifest as unknown as DatasetManifest
  return {
    id: d.id,
    name: d.name,
    version: d.version,
    kind: d.kind,
    role: d.role,
    clips: m.audio?.clips ?? 0,
    roles: [...new Set((m.labels ?? []).map((l) => l.role))],
    license: m.provenance?.[0]?.license ?? 'unknown',
    commercialUse: m.provenance?.[0]?.commercialUse ?? true,
    available: true,
    manifest: m,
  }
}

function fromBuiltin(e: DatasetCatalogEntry): PickableDataset {
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
  }
}

export function DatasetPicker({ client, requirements, value, onChange }: DatasetPickerProps) {
  const [storeDatasets, setStoreDatasets] = useState<StoreDataset[] | null>(null)
  const [builtins, setBuiltins] = useState<DatasetCatalogEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // Built-ins come from the static catalog (always; no backend needed to list).
  useEffect(() => {
    let cancelled = false
    fetch(resolveAsset('datasets.json'))
      .then((res) => {
        if (!res.ok) throw new Error(`built-in catalog (HTTP ${res.status})`)
        return res.json()
      })
      .then((catalog) => {
        if (cancelled) return
        const validation = validateDatasetCatalog(catalog)
        if (!validation.ok) {
          setError(`built-in catalog is invalid: ${validation.errors.join('; ')}`)
          return
        }
        setBuiltins(catalog.datasets)
      })
      .catch((err: unknown) => {
        // A missing catalog degrades to store-only, not a hard failure.
        if (!cancelled) setBuiltins([])
        void err
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Store datasets from the connected studio-backend.
  useEffect(() => {
    if (!client) {
      setStoreDatasets(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    client
      .listDatasets()
      .then((list) => {
        if (!cancelled) setStoreDatasets(list)
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
          setStoreDatasets(null)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [client])

  // Merge built-ins + store datasets into one list (dedup by id, builtin wins).
  const pickable = useMemo<PickableDataset[]>(() => {
    const byId = new Map<string, PickableDataset>()
    for (const d of storeDatasets ?? []) byId.set(d.id, fromStore(d))
    for (const e of builtins ?? []) byId.set(e.id, fromBuiltin(e))
    const all = [...byId.values()]
    // available built-ins first, then store datasets, then pending-host built-ins
    const rank = (p: PickableDataset) =>
      p.available ? 0 : p.kind === 'builtin' ? 2 : 1
    return all.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
  }, [storeDatasets, builtins])

  const selected = useMemo(() => {
    const set = new Set(value ? value.split(',').map((s) => s.trim()).filter(Boolean) : [])
    return pickable.filter((d) => set.has(d.id))
  }, [pickable, value])

  const toggle = useCallback(
    (id: string) => {
      const next = new Set(value ? value.split(',').map((s) => s.trim()).filter(Boolean) : [])
      if (next.has(id)) next.delete(id)
      else next.add(id)
      onChange([...next].join(','))
    },
    [value, onChange],
  )

  // Validate the combined selection against spec.train.dataset — clear
  // warnings/errors instead of a trainer crash at job time.
  const validation = useMemo(
    () =>
      validateDatasetRequirements(
        selected.map((d) => ({ manifest: d.manifest })),
        requirements,
      ),
    [selected, requirements],
  )

  const empty = pickable.length === 0 && !loading

  return (
    <div className="rounded-xl border border-line bg-surface-2 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink-1">Datasets</h3>
        <span className="rounded-full bg-surface-3 px-2 py-0.5 font-mono text-[10px] text-ink-3">
          {selected.length} selected
        </span>
      </div>
      <p className="mt-0.5 text-xs text-ink-3">
        One or more existing datasets (built-ins + your store). The materializer merges
        roles — positives = wake word, unknowns →{' '}
        <span className="font-mono">_unknown_</span>, noise →{' '}
        <span className="font-mono">_background_noise_</span>.
      </p>

      {loading && <p className="mt-3 text-xs text-ink-3">Loading datasets…</p>}
      {error && <p className="mt-3 text-xs text-danger">{error}</p>}
      {empty && !error && (
        <p className="mt-3 text-xs text-ink-3">
          No datasets available yet — generate one in the Datasets console (or import a
          wake-studio-dataset.zip), then come back.
        </p>
      )}

      {pickable.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {pickable.map((d) => {
            const on = selected.some((s) => s.id === d.id)
            return (
              <label
                key={d.id}
                className={cn(
                  'flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 transition-colors',
                  d.available
                    ? on
                      ? 'border-brand-9/60 bg-brand-9/10'
                      : 'border-line bg-surface-3 hover:border-ink-4'
                    : 'cursor-not-allowed border-line bg-surface-3 opacity-60',
                )}
              >
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 accent-[var(--brand-9)]"
                  checked={on}
                  disabled={!d.available}
                  onChange={() => toggle(d.id)}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-medium text-ink-1">{d.name}</span>
                    <span className="rounded-full bg-surface-3 px-1.5 py-0.5 text-[10px] text-ink-3">
                      v{d.version}
                    </span>
                    <span className="rounded-full bg-surface-3 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-ink-3">
                      {KIND_LABEL[d.kind] ?? d.kind}
                    </span>
                    <span className="rounded-full bg-surface-3 px-1.5 py-0.5 font-mono text-[10px] text-ink-3">
                      {d.clips > 0 ? `${d.clips} clips · ` : ''}
                      {d.roles.join('/') || (ROLE_LABEL[d.role] ?? d.role)}
                    </span>
                    {d.commercialUse === false && (
                      <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-700">
                        non-commercial
                      </span>
                    )}
                    {!d.available && (
                      <span className="rounded-full bg-surface-3 px-1.5 py-0.5 text-[10px] text-ink-3">
                        not hosted yet
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-ink-3" title={d.id}>
                    {d.id}
                    {d.license && <span className="text-ink-4"> · {d.license}</span>}
                  </span>
                  {!d.available && d.note && (
                    <span className="mt-0.5 block text-[11px] leading-relaxed text-ink-3">
                      {d.note}
                    </span>
                  )}
                </span>
              </label>
            )
          })}
        </div>
      )}

      {!client && pickable.length > 0 && (
        <p className="mt-3 border-t border-line pt-3 text-xs text-ink-3">
          Built-ins are listed here, but training needs a{' '}
          <span className="font-medium text-ink-2">studio-backend</span> connection to
          materialize them (and to load your store's datasets) — connect one in the
          Backends menu.
        </p>
      )}

      {selected.length > 0 && (
        <div className="mt-3 space-y-2 border-t border-line pt-3">
          {validation.errors.map((e) => (
            <p key={e} className="rounded-md border border-danger/30 bg-danger/5 px-2.5 py-1.5 text-xs text-danger">
              {e}
            </p>
          ))}
          {validation.warnings.map((w) => (
            <p key={w} className="rounded-md border border-amber-500/30 bg-amber-500/5 px-2.5 py-1.5 text-xs text-amber-700">
              {w}
            </p>
          ))}
          {validation.ok && validation.errors.length === 0 && validation.warnings.length === 0 && (
            <p className="text-xs text-success">These datasets satisfy the trainer's requirements.</p>
          )}
        </div>
      )}
    </div>
  )
}
