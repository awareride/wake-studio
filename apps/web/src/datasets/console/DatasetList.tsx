/**
 * Datasets console — dataset list rail (ADR-044 §8, #208).
 *
 * A PURE list (no header/toggle/scroll — those live in the shared
 * ConsolePanel): one row per dataset with its kind badge
 * (builtin/generated/uploaded/public + optional cloud chip), clip count and
 * license. Selection closes the mobile drawer via the
 * ConsolePanel-provided close callback (no-op on desktop).
 */

import { cn } from '../../components/cn'
import type { ConsoleDataset } from '../store'
import {
  KIND_LABEL,
  kindBadgeClass,
  formatClips,
  formatBytes,
  rolesLabel,
} from './dataset-meta'

export interface DatasetListProps {
  datasets: ConsoleDataset[]
  selectedId: string | null
  onSelect: (id: string) => void
  loading?: boolean
}

export function DatasetList({ datasets, selectedId, onSelect, loading }: DatasetListProps) {
  if (loading && datasets.length === 0) {
    return (
      <div className="px-4 py-6 text-xs leading-relaxed text-ink-3">
        Loading datasets…
      </div>
    )
  }

  if (datasets.length === 0) {
    return (
      <div className="px-4 py-6 text-xs leading-relaxed text-ink-3">
        No datasets yet. Press <span className="font-medium text-ink-2">New</span> (the wizard
        wand) to generate one with a TTS engine — built-ins and generated datasets land here.
      </div>
    )
  }

  return (
    <ul className="space-y-1 px-2 pb-4">
      {datasets.map((d) => {
        const selected = d.id === selectedId
        return (
          <li key={d.id}>
            <button
              type="button"
              onClick={() => onSelect(d.id)}
              aria-pressed={selected}
              className={cn(
                'w-full rounded-lg border px-3 py-2 text-left transition-colors',
                selected
                  ? 'border-brand-9/50 bg-brand-9/5'
                  : 'border-transparent hover:border-line hover:bg-surface-2',
              )}
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <span
                  className={cn(
                    'rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide',
                    kindBadgeClass(d.kind),
                  )}
                >
                  {KIND_LABEL[d.kind] ?? d.kind}
                </span>
                {d.cloud && (
                  <span className="rounded-full bg-surface-3 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-3">
                    cloud
                  </span>
                )}
                {!d.available && (
                  <span className="rounded-full bg-surface-3 px-1.5 py-0.5 text-[10px] text-ink-3">
                    not hosted yet
                  </span>
                )}
              </div>
              <div className="mt-1 truncate text-xs font-medium text-ink-1" title={d.name}>
                {d.name}
              </div>
              <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-ink-3">
                <span className="font-mono">{d.id}</span>
                <span aria-hidden>·</span>
                <span>v{d.version}</span>
                <span aria-hidden>·</span>
                <span>{formatClips(d.clips)}</span>
                {d.sizeBytes !== undefined && (
                  <>
                    <span aria-hidden>·</span>
                    <span>{formatBytes(d.sizeBytes)}</span>
                  </>
                )}
              </div>
              <div className="mt-0.5 truncate text-[10px] text-ink-3">
                {rolesLabel(d.roles, d.role)}
                {d.license && (
                  <>
                    <span aria-hidden> · </span>
                    <span title={d.license}>{d.license}</span>
                  </>
                )}
              </div>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
