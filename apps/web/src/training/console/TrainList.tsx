/**
 * Training console — train list (issue #105).
 *
 * The persistent train list on the left: every recorded job (status, phrase,
 * module, method, artifact ref, time, latest notification as a note).
 * Selecting a job opens its details in the right pane. The TRAINS header
 * carries the rail toggle (sidebar-trigger style): desktop collapses the
 * inline rail, mobile opens the train-list drawer. Deleting happens per
 * train (details → Operations → Delete), so there is no bulk Clear button.
 * Persisted in IndexedDB.
 */

import { latestMessage, sortJobsNewestFirst, type HistoryJob } from '@wake-studio/module-training'
import { cn } from '../../components/cn'
import { IconMenu } from '../../components/icons'
import { StatusChip } from './StatusChip'

export interface TrainListProps {
  jobs: HistoryJob[]
  selectedId: string | null
  onSelect: (id: string) => void
  /** Toggle the rail: desktop collapses the inline list, mobile opens the drawer. */
  onToggle: () => void
}

function formatWhen(ms: number): string {
  const diff = Date.now() - ms
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return new Date(ms).toLocaleDateString()
}

export function TrainList({ jobs, selectedId, onSelect, onToggle }: TrainListProps) {
  const ordered = sortJobsNewestFirst(jobs)

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center gap-1.5 px-4 pb-2 pt-3">
        <button
          type="button"
          onClick={onToggle}
          aria-label="Toggle train list"
          className="rounded-md p-1 text-ink-3 transition-colors hover:bg-surface-3 hover:text-ink-1"
        >
          <IconMenu className="h-4 w-4" />
        </button>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-3">Trains</h3>
        {jobs.length > 0 && (
          <span className="ml-auto rounded-full bg-surface-3 px-1.5 py-0.5 text-[10px] text-ink-3">
            {jobs.length}
          </span>
        )}
      </div>

      {ordered.length === 0 ? (
        <div className="px-4 py-6 text-xs leading-relaxed text-ink-3">
          No trains yet. Press <span className="font-medium text-ink-2">New</span> (the wizard
          wand) to start one — jobs land here for re-inspection (IndexedDB, client-side).
        </div>
      ) : (
        <ul className="flex-1 space-y-1 overflow-y-auto px-2 pb-4">
          {ordered.map((job) => {
            const selected = job.id === selectedId
            const note = latestMessage(job)
            return (
              <li key={job.id}>
                <button
                  type="button"
                  onClick={() => onSelect(job.id)}
                  aria-pressed={selected}
                  className={cn(
                    'w-full rounded-lg border px-3 py-2 text-left transition-colors',
                    selected
                      ? 'border-brand-9/50 bg-brand-9/5'
                      : 'border-transparent hover:border-line hover:bg-surface-2',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <StatusChip status={job.status} />
                    <span className="text-[10px] text-ink-3">{formatWhen(job.startedAtMs)}</span>
                  </div>
                  <div className="mt-1 truncate text-xs font-medium text-ink-1">
                    “{job.phrase || 'unknown phrase'}”
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-ink-3">
                    <span className="font-mono">{job.method}</span>
                    <span aria-hidden>·</span>
                    <span className="truncate">{job.moduleId}</span>
                    {job.artifactRef && (
                      <>
                        <span aria-hidden>·</span>
                        <span className="truncate" title={job.artifactRef}>
                          {job.artifactRef}
                        </span>
                      </>
                    )}
                  </div>
                  {/* Note: the latest notification for this train (issue #105). */}
                  {note && (
                    <div className="mt-1 truncate text-[10px] italic text-ink-3" title={note.message}>
                      {note.message}
                    </div>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}