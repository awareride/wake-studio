/**
 * Training console — train details (review) (issue #105).
 *
 * The right-hand review pane for a selected train: status, results (metrics /
 * artifact / license), and the inputs review (the .ipynb notebook for Colab).
 * For a Colab train that has not been imported yet, the import step lives
 * here — starting a train opens this pane ("open this train review when
 * started").
 */

import { useMemo, useState } from 'react'
import {
  backendToMethod,
  deriveMessages,
  type HistoryJob,
} from '@wake-studio/module-training'
import { cn } from '../../components/cn'
import { ImportColabResults } from '../ImportColabResults'
import type { ColabImportResult } from '../colab-import'
import { findTrainableModule, type TrainableModule } from '../train-modules'
import { FileReviewCard } from './FileReviewCard'
import { NotebookReviewView } from './NotebookReviewView'
import { StatusChip } from './StatusChip'
import { trainInputFile } from './train-files'

export interface TrainDetailsProps {
  job: HistoryJob
  modules: TrainableModule[]
  onImported: (result: ColabImportResult) => void
  /** Persist a change to the job's Colab tunnel URL. */
  onTunnelUrlChange: (url: string) => void
}

function formatTime(ms: number | undefined): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleString()
}

export function TrainDetails({ job, modules, onImported, onTunnelUrlChange }: TrainDetailsProps) {
  const module = findTrainableModule(modules, job.moduleId)
  const exportable = job.license === 'user-owned'
  const metrics = job.metrics ?? {}
  const isColab = job.method === 'colab' || backendToMethod(job.backend) === 'colab'
  const needsImport = isColab && job.status !== 'succeeded'
  const file = module ? trainInputFile(module, isColab ? 'colab' : job.method) : null
  const messages = deriveMessages(job)

  // Full-panel notebook review (Back preserves the details state, #105).
  const [reviewing, setReviewing] = useState(false)
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
        onBack={() => setReviewing(false)}
        personalize={personalizable}
      />
    )
  }

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

      {/* Results. */}
      <section className="rounded-xl border border-line bg-surface-2 p-4">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-3">Results</h4>
        {job.status === 'succeeded' ? (
          <>
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
            appear here once the train finishes and the bundle is imported.
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
                      ? 'bg-brand-500'
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
            onReview={() => setReviewing(true)}
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
              className="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 font-mono text-xs text-ink-1 outline-none placeholder:text-ink-3 focus:border-brand-400"
            />
            <p className="text-[11px] leading-relaxed text-ink-3">
              The notebook prints this URL while running (cloudflared, ADR-023 amendment). With
              it, WakeStudio can poll status and pull results. Auto-detect: if you set a
              Cloudflare API key in Settings, the notebook writes the URL into the results
              bundle and it is picked up on import.
            </p>
          </div>

          {/* Status-traceability tip (issue #105): manual submit when the
              tunnel cannot be traced. */}
          {job.tunnelUrl ? (
            <p className="rounded-lg border border-success/30 bg-success/5 px-3 py-2 text-[11px] leading-relaxed text-success">
              ✓ Tunnel URL set — this run's status can be tracked and results pulled
              automatically (polling lands with the Phase 5 backend adapter).
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

      {!isColab && (
        <p className="text-xs text-ink-3">
          The {job.method === 'subprocess' ? 'self-hosted service' : 'CI'} method lands in a
          later Phase 5 slice — this train is recorded for now.
        </p>
      )}
    </div>
  )
}