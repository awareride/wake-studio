/**
 * Datasets console — generation/storage job details (ADR-044 §8, #208).
 *
 * The right-hand review pane for a selected job: status, NDJSON progress,
 * logs and (for backend jobs) live tracking via the shared StudioClient
 * (SSE / polling, the same machinery Training uses) + lifecycle/delete
 * actions. Browser jobs report progress locally from the browser executor.
 */

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@radix-ui/themes'
import { cn } from '../../components/cn'
import { IconSpinner } from '../../components/icons'
import { useAppSettings } from '../../settings'
import { isActiveStatus, useStudioJob } from '../../training/useStudioJob'
import type { StudioJob } from '../../training/studio-client'
import { STATUS_STYLE } from '../../training/console/StatusChip'
import { ConfirmDialog } from '../../training/console/ConfirmDialog'
import type { DatasetJob, DatasetJobKind } from '../jobs'

export const JOB_KIND_TITLE: Record<DatasetJobKind, string> = {
  generate: 'Generation job',
  storage: 'Storage job',
  check: 'Quality check job',
  split: 'Split job',
}

export interface DatasetJobDetailsProps {
  job: DatasetJob
  /** Merge live backend state into the job (the console's useDatasetJobs.applyLive). */
  onLiveUpdate: (id: string, live: StudioJob) => void
  onDelete: (id: string) => void
}

function formatTime(ms: number | undefined): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleString()
}

export function DatasetJobDetails({ job, onLiveUpdate, onDelete }: DatasetJobDetailsProps) {
  const { platform, backends } = useAppSettings()
  const [logsOpen, setLogsOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const managedBackend = job.endpoint ? backends.find((b) => b.baseUrl === job.endpoint) : undefined
  const token =
    managedBackend?.token || platform['backend.apiKey'] || platform['backend.secret'] || undefined
  const tracked = !!job.endpoint
  const { live, mode, actions } = useStudioJob({
    jobId: tracked ? job.id : undefined,
    endpoint: tracked ? job.endpoint : undefined,
    token,
    enabled: tracked && isActiveStatus(job.status),
  })

  // Push live backend state into the recorded job.
  useEffect(() => {
    if (!live) return
    onLiveUpdate(job.id, live)
  }, [live, job.id, onLiveUpdate])

  const progress = live?.progress ?? job.progress
  const liveLogTail = live?.logTail ?? job.logTail
  const logs = liveLogTail ?? []
  const error = job.error ?? live?.error
  const status = live?.status ?? job.status

  const summary = useMemo(() => {
    const first = Object.entries(job.params).slice(0, 6)
    return first
  }, [job.params])

  return (
    <div className="space-y-5">
      {/* Header. */}
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold text-ink-1">{JOB_KIND_TITLE[job.kind]}</h3>
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
            STATUS_STYLE[status],
          )}
        >
          {status}
        </span>
        <span className="rounded-full bg-surface-3 px-2 py-0.5 font-mono text-[10px] text-ink-3">
          {job.moduleId}
        </span>
        <span className="rounded-full bg-surface-3 px-2 py-0.5 font-mono text-[10px] text-ink-3">
          {job.executor}
        </span>
        <span className="rounded-full bg-surface-3 px-2 py-0.5 font-mono text-[10px] text-ink-3">
          {job.id}
        </span>
      </div>

      {/* Status. */}
      <section className="rounded-xl border border-line bg-surface-2 p-4">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-3">Status</h4>
        <dl className="mt-2 grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
          <div className="flex justify-between gap-3">
            <dt className="text-ink-3">Started</dt>
            <dd className="font-mono text-ink-1">{formatTime(job.startedAtMs)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink-3">Finished</dt>
            <dd className="font-mono text-ink-1">
              {formatTime(job.finishedAtMs ?? live?.finishedAtMs ?? undefined)}
            </dd>
          </div>
          {job.resultDatasetId && (
            <div className="flex justify-between gap-3 sm:col-span-2">
              <dt className="text-ink-3">Dataset</dt>
              <dd className="truncate font-mono text-ink-1" title={job.resultDatasetId}>
                {job.resultDatasetId}
              </dd>
            </div>
          )}
          {error && (
            <div className="flex justify-between gap-3 sm:col-span-2">
              <dt className="text-ink-3">Error</dt>
              <dd className="font-mono text-danger">{error}</dd>
            </div>
          )}
        </dl>
      </section>

      {/* Live progress (NDJSON). */}
      {(typeof progress === 'number' || mode !== 'idle') && (
        <section className="space-y-3 rounded-xl border border-line bg-surface-2 p-4">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-3">
              {job.executor === 'backend' ? 'Live progress' : 'Browser progress'}
            </h4>
            <span className="flex items-center gap-2 text-[10px] text-ink-3">
              {isActiveStatus(status) && <IconSpinner className="h-3 w-3 text-brand-11" />}
              {job.executor === 'backend' && mode !== 'idle' && (
                <span className="rounded-full bg-surface-3 px-2 py-0.5 font-mono">
                  {mode === 'sse' ? 'SSE' : 'polling'}
                </span>
              )}
            </span>
          </div>
          {typeof progress === 'number' && (
            <div className="space-y-1">
              <div className="flex justify-between text-[11px] text-ink-3">
                <span>Progress</span>
                <span className="font-mono">{Math.round(progress * 100)}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
                <div
                  className="h-full rounded-full bg-brand-9 transition-all"
                  style={{ width: `${Math.min(100, Math.max(0, progress * 100))}%` }}
                />
              </div>
            </div>
          )}

          {logs.length > 0 && (
            <div className="rounded-lg border border-line bg-surface-1">
              <button
                type="button"
                onClick={() => setLogsOpen((o) => !o)}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-[11px] font-medium text-ink-2"
              >
                <span>Log ({logs.length} lines)</span>
                <span aria-hidden>{logsOpen ? '−' : '+'}</span>
              </button>
              {logsOpen && (
                <pre className="max-h-48 overflow-auto border-t border-line px-3 py-2 font-mono text-[10px] leading-relaxed text-ink-2">
                  {logs.join('\n')}
                </pre>
              )}
            </div>
          )}

          {/* Lifecycle actions for a live backend job. */}
          {tracked && isActiveStatus(status) && (
            <div className="flex flex-wrap gap-2">
              {(status === 'running' || status === 'queued' || status === 'paused') && (
                <Button type="button" size="1" variant="soft" color="red" onClick={actions.cancel}>
                  Cancel
                </Button>
              )}
            </div>
          )}
        </section>
      )}

      {/* Params review. */}
      <section className="rounded-xl border border-line bg-surface-2 p-4">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-3">Inputs</h4>
        <dl className="mt-2 grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
          {summary.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3">
              <dt className="text-ink-3">{k}</dt>
              <dd className="truncate font-mono text-ink-1" title={v}>
                {v}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Operations. */}
      <section className="rounded-xl border border-danger/25 bg-surface-2 p-4">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-3">Operations</h4>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-ink-3">
            Remove this job from the rail. For a backend job this also cancels/deletes it on the
            studio-backend; generated datasets already persisted are not affected.
          </p>
          <Button
            type="button"
            onClick={() => setConfirmDelete(true)}
            variant="outline"
            color="red"
            size="1"
            className="text-xs"
          >
            Delete
          </Button>
        </div>
      </section>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this job?"
        message={
          tracked
            ? 'This deletes the job on the studio-backend and removes it from the rail.'
            : 'This removes the job from the rail. Any dataset it generated stays in the local store.'
        }
        confirmLabel="Delete"
        onConfirm={() => {
          setConfirmDelete(false)
          void actions.delete().finally(() => onDelete(job.id))
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  )
}
