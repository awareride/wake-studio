/**
 * Training wizard — Dataset picker (issue #206).
 *
 * Replaces the `dataSource` source-selector with a `datasets[]` picker fed
 * from the backend Datasets store (GET /datasets, ADR-044 #204). The user
 * picks one or more existing datasets; the picker validates the selection
 * against the module's `spec.train.dataset` requirements (core/materialize.ts
 * `validateDatasetRequirements`) so the user gets clear warnings instead of a
 * cryptic trainer crash.
 *
 * The picked dataset ids are comma-joined into the `datasets` train param,
 * which flows through the registry (`STREAM_DATASETS` / `WAKE_DATASETS`) to
 * the adapter's load-refs → materialize → merge (ADR-031).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  validateDatasetRequirements,
  type DatasetManifest,
  type TrainerDatasetRequirements,
} from '@wake-studio/module-dataset'
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

export function DatasetPicker({ client, requirements, value, onChange }: DatasetPickerProps) {
  const [datasets, setDatasets] = useState<StoreDataset[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!client) {
      setDatasets(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    client
      .listDatasets()
      .then((list) => {
        if (!cancelled) setDatasets(list)
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
          setDatasets(null)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [client])

  const selected = useMemo(() => {
    const set = new Set(value ? value.split(',').map((s) => s.trim()).filter(Boolean) : [])
    return (datasets ?? []).filter((d) => set.has(d.id))
  }, [datasets, value])

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
        selected.map((d) => ({ manifest: d.manifest as unknown as DatasetManifest })),
        requirements,
      ),
    [selected, requirements],
  )


  if (!client) {
    return (
      <div className="rounded-xl border border-line bg-surface-2 p-4">
        <h3 className="text-sm font-semibold text-ink-1">Datasets</h3>
        <p className="mt-1.5 text-xs leading-relaxed text-ink-3">
          Connect a <span className="font-medium text-ink-2">studio-backend</span> in the
          Backends menu to load the datasets this trainer will train on (one or more from
          the Datasets store).
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-line bg-surface-2 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink-1">Datasets</h3>
        <span className="rounded-full bg-surface-3 px-2 py-0.5 font-mono text-[10px] text-ink-3">
          {selected.length} selected
        </span>
      </div>
      <p className="mt-0.5 text-xs text-ink-3">
        One or more existing datasets (the materializer merges roles — positives = wake
        word, unknowns → <span className="font-mono">_unknown_</span>, noise →{' '}
        <span className="font-mono">_background_noise_</span>).
      </p>

      {loading && <p className="mt-3 text-xs text-ink-3">Loading datasets…</p>}
      {error && <p className="mt-3 text-xs text-danger">{error}</p>}
      {!loading && !error && datasets && datasets.length === 0 && (
        <p className="mt-3 text-xs text-ink-3">
          No datasets in the store yet — generate one in the Datasets console (or import a
          wake-studio-dataset.zip), then come back.
        </p>
      )}

      {datasets && datasets.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {datasets.map((d) => {
            const on = selected.some((s) => s.id === d.id)
            const clips = d.manifest.audio?.clips ?? 0
            const roles = [...new Set((d.manifest.labels ?? []).map((l) => l.role))]
            return (
              <label
                key={d.id}
                className={cn(
                  'flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 transition-colors',
                  on ? 'border-brand-9/60 bg-brand-9/10' : 'border-line bg-surface-3 hover:border-ink-4',
                )}
              >
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 accent-[var(--brand-9)]"
                  checked={on}
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
                      {clips} clips · {roles.join('/') || (ROLE_LABEL[d.role] ?? d.role)}
                    </span>
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-ink-3" title={d.id}>
                    {d.id}
                  </span>
                </span>
              </label>
            )
          })}
        </div>
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
