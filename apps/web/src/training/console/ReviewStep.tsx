/**
 * Training console — Step 4: Review (issue #105).
 *
 * Review card for the finished job: status, metrics, license provenance,
 * artifact ref, and next steps (in-browser test + export). The console
 * auto-advances here when a job succeeds (plan T-7); otherwise the user
 * reaches it manually after importing Colab results.
 */

import { type HistoryJob } from '@wake-studio/module-training'
import { cn } from '../../components/cn'

export interface ReviewStepProps {
  /** The job under review (may be null when history is empty). */
  job: HistoryJob | null
  /** A human-readable label for the KWS panel to load the model. */
  testModelHint?: string
}

export function ReviewStep({ job, testModelHint }: ReviewStepProps) {
  if (!job) {
    return (
      <div className="rounded-xl border border-line bg-surface-2 p-6 text-sm text-ink-2">
        Nothing to review yet. Run a job in step 3 (or import Colab results) —
        this step auto-advances on success.
      </div>
    )
  }

  const exportable = job.license === 'user-owned'
  const metrics = job.metrics ?? {}

  return (
    <div className="space-y-6">
      <div
        className={cn(
          'rounded-xl border p-5',
          job.status === 'succeeded'
            ? 'border-success/30 bg-success/5'
            : 'border-line bg-surface-2',
        )}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-ink-1">
            {job.status === 'succeeded' ? '✓ Job succeeded' : `Job ${job.status}`}
          </span>
          <span className="rounded-full bg-surface-3 px-2 py-0.5 font-mono text-[10px] text-ink-3">
            {job.id}
          </span>
        </div>

        <dl className="mt-4 grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
          <div className="flex justify-between gap-3">
            <dt className="text-ink-3">Wake phrase</dt>
            <dd className="font-medium text-ink-1">“{job.phrase || '—'}”</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink-3">Backend</dt>
            <dd className="font-mono text-ink-1">{job.backend}</dd>
          </div>
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
          <div className="flex justify-between gap-3">
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
          {job.artifactRef && (
            <div className="flex justify-between gap-3">
              <dt className="text-ink-3">Artifact</dt>
              <dd className="truncate font-mono text-ink-1" title={job.artifactRef}>
                {job.artifactRef}
              </dd>
            </div>
          )}
        </dl>

        <p className="mt-4 text-xs leading-relaxed text-ink-2">
          {exportable
            ? 'User-owned — the Phase 4 export license gate treats this model as commercially clean.'
            : job.license
              ? `Not user-owned (${job.license}) — a commercial export will be blocked.`
              : 'Provenance not recorded for this job.'}{' '}
          Open the <span className="font-medium text-ink-1">KWS detection</span> panel and
          press <span className="font-medium text-ink-1">Load models</span> to test the model
          in-browser{testModelHint ? ` (${testModelHint})` : ''}, then export a bundle in the
          Model library.
        </p>
      </div>
    </div>
  )
}