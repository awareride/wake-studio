/**
 * Training console — train details (review) (issue #105).
 *
 * The right-hand review pane for a selected train: status, results (metrics /
 * artifact / license), and the inputs review (the .ipynb notebook for Colab).
 * For a Colab train that has not been imported yet, the import step lives
 * here — starting a train opens this pane ("open this train review when
 * started").
 */

import {
  backendToMethod,
  type HistoryJob,
} from '@wake-studio/module-training'
import { cn } from '../../components/cn'
import { ImportColabResults } from '../ImportColabResults'
import type { ColabImportResult } from '../colab-import'
import { findTrainableModule, type TrainableModule } from '../train-modules'
import { FileReviewCard } from './FileReviewCard'
import { StatusChip } from './StatusChip'
import { trainInputFile } from './train-files'

export interface TrainDetailsProps {
  job: HistoryJob
  modules: TrainableModule[]
  onImported: (result: ColabImportResult) => void
}

function formatTime(ms: number | undefined): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleString()
}

export function TrainDetails({ job, modules, onImported }: TrainDetailsProps) {
  const module = findTrainableModule(modules, job.moduleId)
  const exportable = job.license === 'user-owned'
  const metrics = job.metrics ?? {}
  const isColab = job.method === 'colab' || backendToMethod(job.backend) === 'colab'
  const needsImport = isColab && job.status !== 'succeeded'
  const file = module ? trainInputFile(module, isColab ? 'colab' : job.method) : null

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

      {/* Inputs review: the file that trains (the .ipynb for Colab). */}
      <section className="space-y-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-3">Inputs review</h4>
        {file ? (
          <FileReviewCard
            title={file.title}
            fileName={file.fileName}
            rawUrl={file.rawUrl}
            openUrl={file.openUrl}
            openLabel={file.openLabel}
            description={file.description}
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
        <section className="rounded-xl border border-line bg-surface-2 p-4">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-3">
            {needsImport ? 'Run & import' : 'Re-import'}
          </h4>
          <p className="mt-1.5 text-xs leading-relaxed text-ink-2">
            {needsImport
              ? 'Run the notebook in Colab (free GPU, your Google account), download wake-studio-results.zip, and import it below — this train\'s results update here.'
              : 'This train was already imported. You can import an updated bundle below if you retrained.'}
          </p>
          <div className="mt-3">
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