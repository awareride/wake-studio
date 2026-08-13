/**
 * Training console — history rail (issue #105).
 *
 * Persistent left rail listing past training jobs from IndexedDB
 * (status / params / backend / timestamps / artifact ref). Browsing is
 * orthogonal to the stepper flow — the rail never blocks navigation.
 */

import { useState } from 'react'
import {
  sortJobsNewestFirst,
  type HistoryJob,
  clearJobs,
} from '@wake-studio/module-training'
import { cn } from '../../components/cn'

function formatWhen(ms: number): string {
  const diff = Date.now() - ms
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return new Date(ms).toLocaleDateString()
}

const STATUS_STYLE: Record<HistoryJob['status'], string> = {
  queued: 'bg-amber-500/15 text-amber-700',
  running: 'bg-brand-500/15 text-brand-600',
  succeeded: 'bg-emerald-500/15 text-emerald-700',
  failed: 'bg-danger/15 text-danger',
  canceled: 'bg-surface-3 text-ink-3',
}

export interface HistoryRailProps {
  jobs: HistoryJob[]
  selectedId: string | null
  onSelect: (id: string) => void
  /** Called after the user clears the rail (store already wiped). */
  onCleared: () => void
}

export function HistoryRail({ jobs, selectedId, onSelect, onCleared }: HistoryRailProps) {
  const [confirming, setConfirming] = useState(false)
  const ordered = sortJobsNewestFirst(jobs)

  const clear = () => {
    if (!confirming) {
      setConfirming(true)
      setTimeout(() => setConfirming(false), 2500)
      return
    }
    setConfirming(false)
    void clearJobs().then(onCleared)
  }

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-line">
      <div className="flex items-center justify-between px-4 pb-2 pt-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-3">
          Train history
        </h3>
        {jobs.length > 0 && (
          <button
            type="button"
            onClick={clear}
            className="text-[11px] text-ink-3 underline-offset-2 hover:text-ink-1 hover:underline"
          >
            {confirming ? 'Clear all?' : 'Clear'}
          </button>
        )}
      </div>

      {ordered.length === 0 ? (
        <div className="px-4 py-6 text-xs leading-relaxed text-ink-3">
          No training jobs yet. Start a run or import Colab results — past
          jobs land here for quick re-inspection (IndexedDB, client-side).
        </div>
      ) : (
        <ul className="flex-1 space-y-1 overflow-y-auto px-2 pb-4">
          {ordered.map((job) => {
            const selected = job.id === selectedId
            return (
              <li key={job.id}>
                <button
                  type="button"
                  onClick={() => onSelect(job.id)}
                  aria-pressed={selected}
                  className={cn(
                    'w-full rounded-lg border px-3 py-2 text-left transition-colors',
                    selected
                      ? 'border-brand-500/50 bg-brand-500/5'
                      : 'border-transparent hover:border-line hover:bg-surface-2',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={cn(
                        'rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide',
                        STATUS_STYLE[job.status],
                      )}
                    >
                      {job.status}
                    </span>
                    <span className="text-[10px] text-ink-3">
                      {formatWhen(job.startedAtMs)}
                    </span>
                  </div>
                  <div className="mt-1 truncate text-xs font-medium text-ink-1">
                    “{job.phrase || 'unknown phrase'}”
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-ink-3">
                    <span className="font-mono">{job.backend}</span>
                    {job.artifactRef && (
                      <>
                        <span aria-hidden>·</span>
                        <span className="truncate" title={job.artifactRef}>
                          {job.artifactRef}
                        </span>
                      </>
                    )}
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </aside>
  )
}