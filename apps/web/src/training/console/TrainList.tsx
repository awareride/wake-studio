/**
 * Training console — train list rail items (issue #105).
 *
 * A PURE list (no header/toggle/scroll — those live in the shared
 * ConsolePanel): each item carries the job's status, phrase, method, module
 * and its latest notification note. Selection closes the mobile drawer via
 * the ConsolePanel-provided close callback (no-op on desktop).
 */

import type { HistoryJob } from '@wake-studio/module-training'
import { latestMessage, sortJobsNewestFirst } from '@wake-studio/module-training'
import { cn } from '../../components/cn'
import { StatusChip } from './StatusChip'

export interface TrainListProps {
  jobs: HistoryJob[]
  selectedId: string | null
  onSelect: (id: string) => void
}

export function TrainList({ jobs, selectedId, onSelect }: TrainListProps) {
  const ordered = sortJobsNewestFirst(jobs)

  if (ordered.length === 0) {
    return (
      <div className="px-4 py-6 text-xs leading-relaxed text-ink-3">
        No trains yet. Press <span className="font-medium text-ink-2">New</span> (the wizard
        wand) to start one — jobs land here for re-inspection (IndexedDB, client-side).
      </div>
    )
  }

  return (
    <ul className="space-y-1 px-2 pb-4">
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
                <span className="text-[10px] text-ink-3">
                  {new Date(job.startedAtMs).toLocaleString()}
                </span>
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
  )
}
