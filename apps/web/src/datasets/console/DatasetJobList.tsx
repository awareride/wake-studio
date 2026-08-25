/**
 * Datasets console — generation/storage jobs rail section (ADR-044 §8, #208).
 *
 * Generation jobs appear in the Datasets rail below the dataset list, with
 * the same status vocabulary as Training (queued/running/paused/succeeded/
 * failed/canceled) + a live NDJSON progress note. Backend jobs are tracked
 * live (shared StudioClient, SSE/polling); browser jobs report progress from
 * the browser executor.
 */

import { cn } from '../../components/cn'
import { sortJobsNewestFirst, type DatasetJob, type DatasetJobKind } from '../jobs'
import { STATUS_STYLE } from '../../training/console/StatusChip'

export const JOB_KIND_LABEL: Record<DatasetJobKind, string> = {
  generate: 'Generate',
  storage: 'Storage',
  check: 'Check',
  split: 'Split',
}

export interface DatasetJobListProps {
  jobs: DatasetJob[]
  selectedId: string | null
  onSelect: (id: string) => void
}

export function DatasetJobList({ jobs, selectedId, onSelect }: DatasetJobListProps) {
  const ordered = sortJobsNewestFirst(jobs)
  if (ordered.length === 0) return null

  return (
    <ul className="space-y-1 px-2 pb-4">
      {ordered.map((job) => {
        const selected = job.id === selectedId
        const latest = job.logTail?.[job.logTail.length - 1]
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
                <span
                  className={cn(
                    'rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide',
                    STATUS_STYLE[job.status],
                  )}
                >
                  {job.status}
                </span>
                <span className="text-[10px] text-ink-3">
                  {new Date(job.startedAtMs).toLocaleString()}
                </span>
              </div>
              <div className="mt-1 flex items-center gap-1.5 text-xs font-medium text-ink-1">
                <span>{JOB_KIND_LABEL[job.kind]}</span>
                <span className="rounded-full bg-surface-3 px-1.5 py-0.5 font-mono text-[10px] text-ink-3">
                  {job.executor}
                </span>
                <span className="rounded-full bg-surface-3 px-1.5 py-0.5 font-mono text-[10px] text-ink-3">
                  {job.moduleId}
                </span>
              </div>
              {(job.params.engine || job.params.action) && (
                <div className="mt-0.5 truncate text-[10px] text-ink-3">
                  {job.params.engine || job.params.action}
                  {job.params.phrases ? ` · ${job.params.phrases}` : ''}
                </div>
              )}
              {typeof job.progress === 'number' && job.status === 'running' && (
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-3">
                  <div
                    className="h-full rounded-full bg-brand-9 transition-all"
                    style={{ width: `${Math.min(100, Math.max(0, job.progress * 100))}%` }}
                  />
                </div>
              )}
              {latest && (
                <div className="mt-1 truncate text-[10px] italic text-ink-3" title={latest}>
                  {latest}
                </div>
              )}
            </button>
          </li>
        )
      })}
    </ul>
  )
}
