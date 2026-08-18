/**
 * Training console — train details (review) (issue #105).
 *
 * The right-hand review pane for a selected train: status, results (metrics /
 * artifact / license), and the inputs review (the .ipynb notebook for Colab).
 * For a Colab train that has not been imported yet, the import step lives
 * here — starting a train opens this pane ("open this train review when
 * started").
 *
 * Live tracking (issue #122, ADR-036): when the job has an endpoint (the
 * managed backend URL for Studio-backend trains, or a pasted Colab tunnel
 * URL after Connect), this pane subscribes to the studio-backend job
 * API — SSE when available, polling fallback — and shows live progress,
 * metrics, logs, checkpoint, artifacts and lifecycle actions.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@radix-ui/themes'
import {
  backendToMethod,
  deriveMessages,
  type HistoryJob,
} from '@wake-studio/module-training'
import { cn } from '../../components/cn'
import { IconSpinner } from '../../components/icons'
import { useAppSettings } from '../../settings'
import { ImportColabResults } from '../ImportColabResults'
import type { ColabImportResult } from '../colab-import'
import { pullAndImportBundle } from '../colab-import'
import { findTrainableModule, type TrainableModule } from '../train-modules'
import { isActiveStatus, useStudioJob } from '../useStudioJob'
import { studioJobPatch, type StudioJobPatch } from '../studio-client'
import { ConfirmDialog } from './ConfirmDialog'
import { FileReviewCard } from './FileReviewCard'
import { NotebookReviewView } from './NotebookReviewView'
import { TRAIN_REVIEW_HASH_PREFIX, trainReviewJobFromHash } from '../../router'
import { StatusChip } from './StatusChip'
import { trainInputFile } from './train-files'

export interface TrainDetailsProps {
  job: HistoryJob
  modules: TrainableModule[]
  onImported: (result: ColabImportResult) => void
  /** Persist a change to the job's Colab tunnel URL. */
  onTunnelUrlChange: (url: string) => void
  /** Submit the Colab job to the pasted tunnel URL (issue #122). */
  onConnectColab: () => void
  /** Retry this run: re-submit the same module/params as a fresh job. */
  onRetry: () => void
  /** Merge live studio-backend state into the recorded job (issue #122). */
  onLiveUpdate: (patch: StudioJobPatch) => void
  /** Auto-pull + import of a finished tracked job's results (issue #159). */
  onAutoImported: (jobId: string, result: ColabImportResult) => void
  /** Delete this train from history (confirmed by the details pane). */
  onDelete: () => void
}

function formatTime(ms: number | undefined): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleString()
}

export function TrainDetails({
  job,
  modules,
  onImported,
  onTunnelUrlChange,
  onConnectColab,
  onRetry,
  onLiveUpdate,
  onAutoImported,
  onDelete,
}: TrainDetailsProps) {
  const { platform, backends } = useAppSettings()
  const module = findTrainableModule(modules, job.moduleId)
  const exportable = job.license === 'user-owned'
  const metrics = job.metrics ?? {}
  const isColab = job.method === 'colab' || backendToMethod(job.backend) === 'colab'
  const needsImport = isColab && job.status !== 'succeeded'
  const file = module ? trainInputFile(module, isColab ? 'colab' : job.method) : null
  const messages = deriveMessages(job)

  // Live tracking (issue #122): while the job is active, AND while it has
  // finished but not yet been imported — the backend /stream sends a snapshot
  // of current jobs on connect, so an already-finished job still reports its
  // artifacts and can be auto-pulled + imported (issue #159). Once imported,
  // the track stops.
  const managedBackend = job.backendId ? backends.find((b) => b.id === job.backendId) : undefined
  const token =
    managedBackend?.token || platform['backend.apiKey'] || platform['backend.secret'] || undefined
  const tracked = !!job.endpoint
  const trackForPull = job.status === 'succeeded' && !job.artifactRef
  const { live, mode, error: liveError, actions } = useStudioJob({
    jobId: tracked ? job.id : undefined,
    endpoint: tracked ? job.endpoint : undefined,
    token,
    enabled: tracked && (isActiveStatus(job.status) || trackForPull),
  })

  // Push live backend state into the recorded job (guarded against
  // no-op loops: only call onLiveUpdate when something actually changed).
  useEffect(() => {
    if (!live) return
    const patch = studioJobPatch(live)
    const same =
      patch.status === job.status &&
      patch.progress === job.progress &&
      patch.error === job.error &&
      patch.finishedAtMs === job.finishedAtMs &&
      patch.checkpoint === job.checkpoint &&
      patch.resultArtifact === job.resultArtifact &&
      JSON.stringify(patch.metrics) === JSON.stringify(job.metrics ?? {}) &&
      JSON.stringify(patch.logTail) === JSON.stringify(job.logTail ?? [])
    if (!same) onLiveUpdate(patch)
  }, [live, job, onLiveUpdate])

  // Auto-pull + import (issue #159): once a tracked job finishes successfully
  // and the backend published the results zip, fetch it and register the
  // trained model — no manual download-then-upload round trip. Runs exactly
  // once per job (guarded by a ref set), and the manual button below retries
  // after a failure or when the job was already finished on load.
  const [pulling, setPulling] = useState(false)
  const [pullError, setPullError] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)
  const pullingRef = useRef(false)
  const autoImportStartedRef = useRef<Set<string>>(new Set())
  const resultZipName = useMemo(() => {
    const names = live?.artifacts ?? []
    if (names.includes('wake-studio-results.zip')) return 'wake-studio-results.zip'
    return (
      names.find((n) => n.toLowerCase().endsWith('.zip')) ??
      job.resultArtifact
    )
  }, [live, job.resultArtifact])

  const doPull = useCallback(async () => {
    if (!tracked || !resultZipName || pullingRef.current) return
    pullingRef.current = true
    autoImportStartedRef.current.add(job.id)
    setPulling(true)
    setPullError(null)
    try {
      const result = await pullAndImportBundle(
        actions.artifactUrl(job.id, resultZipName),
      )
      onAutoImported(job.id, result)
    } catch (err) {
      setPullError(err instanceof Error ? err.message : String(err))
      // Allow a retry from the manual button.
      autoImportStartedRef.current.delete(job.id)
    } finally {
      pullingRef.current = false
      setPulling(false)
    }
  }, [tracked, resultZipName, job.id, actions, onAutoImported])

  // Save the raw results zip to disk. A plain cross-origin <a download> is
  // ignored by browsers, so fetch the bytes and download via a blob URL
  // (the artifact endpoint is a read/open route, ADR-036 §5).
  const downloadArtifact = useCallback(async () => {
    if (!tracked || !resultZipName || downloading) return
    setDownloading(true)
    try {
      const res = await fetch(actions.artifactUrl(job.id, resultZipName))
      if (!res.ok) throw new Error(`Download failed (HTTP ${res.status}).`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = resultZipName
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      setPullError(err instanceof Error ? err.message : String(err))
    } finally {
      setDownloading(false)
    }
  }, [tracked, resultZipName, downloading, job.id, actions])

  useEffect(() => {
    if (
      !tracked ||
      !resultZipName ||
      live?.status !== 'succeeded' ||
      job.artifactRef ||
      pullingRef.current ||
      autoImportStartedRef.current.has(job.id)
    ) {
      return
    }
    void doPull()
  }, [tracked, resultZipName, live, job.id, job.artifactRef, doPull])

  // Full-panel notebook review, hash-driven (`#/training/review/<jobId>`,
  // issue #136): opening pushes an entry, browser back closes it. The hash
  // also restores the review across a refresh.
  const [reviewing, setReviewing] = useState(
    () => trainReviewJobFromHash(window.location.hash) === job.id,
  )
  useEffect(() => {
    const onHash = () => {
      setReviewing(trainReviewJobFromHash(window.location.hash) === job.id)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [job.id])
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [logsOpen, setLogsOpen] = useState(false)
  const personalizable = useMemo(
    () =>
      module && file?.kind === 'notebook'
        ? { params: module.train.params ?? [], values: job.params }
        : undefined,
    [module, file, job.params],
  )

  if (reviewing && file) {
    return (
      <NotebookReviewView
        fileName={file.fileName}
        rawUrl={file.rawUrl ?? ''}
        onBack={() => {
          // Pop the review entry — the `#/training` entry below restores the
          // train details (issue #136).
          window.history.back()
        }}
        personalize={personalizable}
      />
    )
  }

  const liveMetrics = live?.metrics ?? job.metrics ?? {}
  const progress = live?.progress ?? job.progress
  const liveArtifacts = live?.artifacts ?? []

  return (
    <div className="space-y-5">
      {/* Header. */}
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold text-ink-1">“{job.phrase || 'Train'}”</h3>
        <StatusChip status={job.status} />
        <span className="rounded-full bg-surface-3 px-2 py-0.5 font-mono text-[10px] text-ink-3">
          {job.moduleId}
        </span>
        <span className="rounded-full bg-surface-3 px-2 py-0.5 font-mono text-[10px] text-ink-3">
          {job.method}
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
            <dd className="font-mono text-ink-1">{formatTime(job.finishedAtMs)}</dd>
          </div>
          {job.error && (
            <div className="flex justify-between gap-3 sm:col-span-2">
              <dt className="text-ink-3">Error</dt>
              <dd className="font-mono text-danger">{job.error}</dd>
            </div>
          )}
        </dl>
      </section>

      {/* Live tracking (issue #122): progress, metrics, logs, actions. */}
      {tracked && (
        <section className="space-y-3 rounded-xl border border-line bg-surface-2 p-4">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-3">
              Live status
            </h4>
            <span className="rounded-full bg-surface-3 px-2 py-0.5 font-mono text-[10px] text-ink-3">
              {mode === 'sse' ? 'SSE' : mode === 'polling' ? 'polling' : 'idle'}
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

          {Object.keys(liveMetrics).length > 0 && (
            <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-3">
              {Object.entries(liveMetrics).map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between gap-3">
                  <dt className="truncate text-ink-3">{k}</dt>
                  <dd className="font-mono text-ink-1">
                    {typeof v === 'number' ? v.toFixed(4) : String(v)}
                  </dd>
                </div>
              ))}
            </dl>
          )}

          {live?.checkpoint && (
            <p className="truncate font-mono text-[11px] text-ink-3" title={live.checkpoint}>
              checkpoint: {live.checkpoint}
            </p>
          )}

          {liveArtifacts.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] text-ink-3">Artifacts:</span>
              {liveArtifacts.map((name) => (
                <a
                  key={name}
                  href={actions.artifactUrl?.(job.id, name) ?? '#'}
                  download={name}
                  className="rounded-lg border border-line bg-surface-2 px-2 py-1 font-mono text-[11px] text-brand-11 hover:border-brand-8"
                >
                  ⬇ {name}
                </a>
              ))}
            </div>
          )}

          {liveError && (
            <p className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-[11px] leading-relaxed text-danger">
              {liveError}
            </p>
          )}

          {/* Lifecycle actions (ADR-036): pause/resume/cancel on the backend. */}
          {isActiveStatus(job.status) && (
            <div className="flex flex-wrap gap-2">
              {job.status === 'running' && (
                <Button type="button" size="1" variant="outline" onClick={actions.pause}>
                  Pause
                </Button>
              )}
              {job.status === 'paused' && (
                <Button type="button" size="1" variant="outline" onClick={actions.resume}>
                  Resume
                </Button>
              )}
              {(job.status === 'running' ||
                job.status === 'queued' ||
                job.status === 'paused') && (
                <Button type="button" size="1" variant="soft" color="red" onClick={actions.cancel}>
                  Cancel
                </Button>
              )}
            </div>
          )}

          {/* Retry a finished run (same module + params, new job on the endpoint). */}
          {!isActiveStatus(job.status) && (
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" size="1" variant="soft" onClick={onRetry}>
                Retry
              </Button>
              <span className="text-[11px] text-ink-3">
                Re-submits the same config as a fresh run.
              </span>
            </div>
          )}

          {/* Log tail — collapsible to keep the pane compact. */}
          {(job.logTail?.length ?? 0) > 0 && (
            <div className="rounded-lg border border-line bg-surface-1">
              <button
                type="button"
                onClick={() => setLogsOpen((o) => !o)}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-[11px] font-medium text-ink-2"
              >
                <span>Log ({job.logTail?.length} lines)</span>
                <span aria-hidden>{logsOpen ? '−' : '+'}</span>
              </button>
              {logsOpen && (
                <pre className="max-h-48 overflow-auto border-t border-line px-3 py-2 font-mono text-[10px] leading-relaxed text-ink-2">
                  {job.logTail?.join('\n') ?? ''}
                </pre>
              )}
            </div>
          )}
        </section>
      )}

      {/* Results. */}
      <section className="rounded-xl border border-line bg-surface-2 p-4">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-3">Results</h4>
        {job.status === 'succeeded' ? (
          <>
            {/* Auto-pull state + manual fallback for a finished tracked job
                whose results are still on the backend (issue #159). */}
            {tracked && resultZipName && (
              <div className="mt-2 rounded-lg border border-brand-8/30 bg-brand-8/5 px-3 py-2 text-[11px] leading-relaxed text-ink-2">
                {pulling ? (
                  <span className="flex items-center gap-2">
                    <IconSpinner className="h-3.5 w-3.5 text-brand-11" />
                    Pulling {resultZipName} from the backend and importing the
                    trained model…
                  </span>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-ink-3">
                        {resultZipName} is on the backend.
                      </span>
                      {!job.artifactRef && (
                        <Button
                          type="button"
                          size="1"
                          onClick={doPull}
                          title="Fetch the results from the backend and register the trained model"
                        >
                          Import
                        </Button>
                      )}
                      <Button
                        type="button"
                        size="1"
                        variant="outline"
                        onClick={downloadArtifact}
                        disabled={downloading}
                        title="Save the raw results zip to disk"
                      >
                        {downloading ? 'Downloading…' : 'Download'}
                      </Button>
                      {job.artifactRef && (
                        <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 font-medium text-emerald-600">
                          ✓ imported
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-[11px] text-ink-3">
                      <span className="font-medium text-ink-2">Import</span>{' '}
                      registers the trained model in your library (in-browser
                      test + export);{' '}
                      <span className="font-medium text-ink-2">Download</span>{' '}
                      saves the raw zip.
                    </p>
                  </>
                )}
                {pullError && (
                  <span className="mt-1 block text-danger">
                    {pullError}
                  </span>
                )}
              </div>
            )}
            <dl className="mt-2 grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
              {typeof metrics.recall === 'number' && (
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-3">Recall</dt>
                  <dd className="font-mono text-ink-1">{metrics.recall.toFixed(3)}</dd>
                </div>
              )}
              {typeof metrics.accuracy === 'number' && (
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-3">Accuracy</dt>
                  <dd className="font-mono text-ink-1">{metrics.accuracy.toFixed(3)}</dd>
                </div>
              )}
              {job.artifactRef && (
                <div className="flex justify-between gap-3 sm:col-span-2">
                  <dt className="text-ink-3">Artifact</dt>
                  <dd className="truncate font-mono text-ink-1" title={job.artifactRef}>
                    {job.artifactRef}
                  </dd>
                </div>
              )}
              <div className="flex justify-between gap-3 sm:col-span-2">
                <dt className="text-ink-3">License</dt>
                <dd
                  className={cn(
                    'rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
                    exportable
                      ? 'bg-emerald-500/10 text-emerald-600'
                      : 'bg-amber-500/10 text-amber-700',
                  )}
                >
                  {job.license ?? '—'}
                </dd>
              </div>
            </dl>
            <p className="mt-3 text-xs leading-relaxed text-ink-2">
              {exportable
                ? 'User-owned — the Phase 4 export license gate treats this model as commercially clean.'
                : job.license
                  ? `Not user-owned (${job.license}) — a commercial export will be blocked.`
                  : 'Provenance not recorded for this job.'}{' '}
              Open the <span className="font-medium text-ink-1">KWS detection</span> panel and
              press <span className="font-medium text-ink-1">Load models</span> to test the model
              in-browser, then export a bundle in the Model library.
            </p>
          </>
        ) : (
          <p className="mt-2 text-xs leading-relaxed text-ink-2">
            No results yet{job.status === 'queued' ? ' — the train is queued' : ''}. Results
            appear here once the train finishes{tracked ? ' and the artifact is pulled' : ' and the bundle is imported'}.
          </p>
        )}
      </section>

      {/* Notifications / messages for this train (issue #105). */}
      <section className="rounded-xl border border-line bg-surface-2 p-4">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-3">Notifications</h4>
        <ul className="mt-2 space-y-1.5">
          {messages.map((m, i) => (
            <li key={i} className="flex items-start gap-2 text-xs text-ink-2">
              <span
                className={cn(
                  'mt-1 h-1.5 w-1.5 shrink-0 rounded-full',
                  m.kind === 'failed' || m.kind === 'canceled'
                    ? 'bg-danger'
                    : m.kind === 'started'
                      ? 'bg-brand-9'
                      : 'bg-emerald-500',
                )}
                aria-hidden
              />
              {m.message}
              <span className="ml-auto shrink-0 text-[10px] text-ink-3">
                {new Date(m.atMs).toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* Inputs review: the file that trains (the .ipynb for Colab). */}
      <section className="space-y-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-3">Inputs review</h4>
        {file ? (
          <FileReviewCard
            title={file.title}
            fileName={file.fileName}
            kind={file.kind}
            rawUrl={file.rawUrl}
            openUrl={file.openUrl}
            openLabel={file.openLabel}
            description={file.description}
            onReview={() => {
              // The review is its own history entry (issue #136): browser back
              // returns to the train details.
              window.location.hash = `#${TRAIN_REVIEW_HASH_PREFIX}/${job.id}`
            }}
            params={job.params}
            paramMeta={module?.train.params}
          />
        ) : (
          <div className="rounded-xl border border-line bg-surface-2 p-4 text-xs text-ink-3">
            {module
              ? 'This module declares no train input file to review.'
              : `Trainable-module catalog unavailable for “${job.moduleId}” (could not load train-modules.json).`}
          </div>
        )}
      </section>

      {/* Import / run step for Colab trains. */}
      {isColab && (
        <section className="space-y-3 rounded-xl border border-line bg-surface-2 p-4">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-3">
            {needsImport ? 'Run & import' : 'Re-import'}
          </h4>

          {/* Colab connection: the tunnel URL is generated when the notebook
              runs — it cannot exist at wizard time (issue #105). */}
          <div className="space-y-1.5">
            <label
              htmlFor={`tunnel-${job.id}`}
              className="block text-xs font-medium text-ink-2"
            >
              Colab tunnel URL{' '}
              <span className="font-normal text-ink-3">(generated when the notebook runs)</span>
            </label>
            <input
              id={`tunnel-${job.id}`}
              type="url"
              placeholder="https://xxxx.trycloudflare.com"
              value={job.tunnelUrl ?? ''}
              onChange={(e) => onTunnelUrlChange(e.target.value)}
              className="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 font-mono text-xs text-ink-1 outline-none placeholder:text-ink-3 focus:border-brand-8"
            />
            <p className="text-[11px] leading-relaxed text-ink-3">
              The notebook prints this URL while running (cloudflared, ADR-023 amendment). With
              it, WakeStudio submits the job to the tunnel and tracks status live (issue #122).
              Auto-detect: if you set a Cloudflare API key in Settings, the notebook writes the
              URL into the results bundle and it is picked up on import.
            </p>
          </div>

          {/* Connect (or retry): submit this job to the tunnel server. */}
          {job.tunnelUrl && !job.submitted && (
            <Button type="button" size="1" onClick={onConnectColab}>
              {job.error ? 'Retry — connect to tunnel' : 'Connect to tunnel & submit'}
            </Button>
          )}

          {/* Status-traceability tip (issue #105 / #122). */}
          {job.tunnelUrl ? (
            <p className="rounded-lg border border-success/30 bg-success/5 px-3 py-2 text-[11px] leading-relaxed text-success">
              {job.submitted
                ? '✓ Connected — status is tracked live (SSE, polling fallback) and results can be pulled.'
                : 'Tunnel URL set — press “Connect to tunnel & submit” to start tracking this run.'}
            </p>
          ) : (
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] leading-relaxed text-amber-700">
              No tunnel URL — WakeStudio cannot trace this Colab run's status. Finish the
              train manually: download{' '}
              <code className="font-mono">wake-studio-results.zip</code> from Colab and
              submit it below.
            </p>
          )}

          <p className="text-xs leading-relaxed text-ink-2">
            {needsImport
              ? 'Run the notebook in Colab (free GPU, your Google account), download wake-studio-results.zip, and import it below — this train\'s results update here.'
              : 'This train was already imported. You can import an updated bundle below if you retrained.'}
          </p>
          <div className="mt-1">
            <ImportColabResults onImported={onImported} />
          </div>
        </section>
      )}

      {/* Operations: delete this train (issue #105). */}
      <section className="rounded-xl border border-danger/25 bg-surface-2 p-4">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-3">Operations</h4>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-ink-3">
            {tracked
              ? 'Remove this train from the list and delete the job on the backend (its artifacts are removed there too). The imported model stays in your model library.'
              : 'Remove this train from the list. The imported model stays in your model library.'}
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
        title="Delete this train?"
        message={
          tracked
            ? 'This deletes the job and its artifacts on the studio-backend and removes the train from your list (IndexedDB).'
            : 'This removes the train from your list (IndexedDB). The imported model in your model library is not affected.'
        }
        confirmLabel="Delete"
        onConfirm={() => {
          setConfirmDelete(false)
          // Best-effort backend delete; the local history entry always goes.
          void actions.delete().finally(onDelete)
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  )
}
