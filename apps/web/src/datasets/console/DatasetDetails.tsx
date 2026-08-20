/**
 * Datasets console — dataset details pane (ADR-044 §8, #208).
 *
 * The right-hand review pane for a selected dataset: the manifest (audio +
 * labels with semantic roles), provenance (the export-gate input, #210),
 * storage (backend path / cloud ref / url) and a quality report. The full
 * health-check job is #209 — this pane renders what the manifest carries
 * today (clip counts, roles, license flags) so the quality view is honest.
 *
 * The actions section (New generation task, Train with this, Upload to cloud,
 * Download, Delete) lands in #208's actions PR.
 */

import type { ConsoleDataset } from '../store'
import { cn } from '../../components/cn'
import {
  KIND_LABEL,
  kindBadgeClass,
  rolesLabel,
  formatClips,
  formatDuration,
  formatBytes,
} from './dataset-meta'

export interface DatasetDetailsProps {
  dataset: ConsoleDataset
}

/** Clip-count estimate per label (manifest.total / label count — the exact
 *  per-label counts come from the #209 health-check job). */
function perLabelCount(dataset: ConsoleDataset): number {
  if (!dataset.manifest.labels?.length) return 0
  return Math.floor(dataset.manifest.audio.clips / dataset.manifest.labels.length)
}

export function DatasetDetails({ dataset }: DatasetDetailsProps) {
  const m = dataset.manifest
  const audio = m.audio
  const perLabel = perLabelCount(dataset)

  return (
    <div className="space-y-5">
      {/* Header. */}
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold text-ink-1">{dataset.name}</h3>
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
            kindBadgeClass(dataset.kind),
          )}
        >
          {KIND_LABEL[dataset.kind] ?? dataset.kind}
        </span>
        <span className="rounded-full bg-surface-3 px-2 py-0.5 font-mono text-[10px] text-ink-3">
          v{dataset.version}
        </span>
        <span className="rounded-full bg-surface-3 px-2 py-0.5 font-mono text-[10px] text-ink-3">
          {dataset.origin}
        </span>
        {dataset.cloud && (
          <span className="rounded-full bg-surface-3 px-2 py-0.5 font-mono text-[10px] text-ink-3">
            {dataset.cloud}
          </span>
        )}
      </div>

      {/* Manifest — audio + labels. */}
      <section className="rounded-xl border border-line bg-surface-2 p-4">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-3">Manifest</h4>
        <dl className="mt-2 grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
          <div className="flex justify-between gap-3">
            <dt className="text-ink-3">Role</dt>
            <dd className="font-mono text-ink-1">{rolesLabel(dataset.roles, dataset.role)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink-3">Clips</dt>
            <dd className="font-mono text-ink-1">{formatClips(audio.clips)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink-3">Duration</dt>
            <dd className="font-mono text-ink-1">{formatDuration(audio.durationSec) || '—'}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink-3">Sample rate</dt>
            <dd className="font-mono text-ink-1">{audio.sampleRate} Hz</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink-3">Channels / encoding</dt>
            <dd className="font-mono text-ink-1">
              {audio.channels} · {audio.encoding}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink-3">Content hash</dt>
            <dd className="truncate font-mono text-ink-1" title={m.contentHash}>
              {m.contentHash ?? '—'}
            </dd>
          </div>
        </dl>

        {/* Labels — the portable vocabulary (semantic roles, §4.2). */}
        {(m.labels?.length ?? 0) > 0 && (
          <div className="mt-3 overflow-x-auto rounded-lg border border-line bg-surface-1">
            <table className="w-full text-left text-[11px]">
              <thead>
                <tr className="border-b border-line text-[10px] uppercase tracking-wide text-ink-3">
                  <th className="px-3 py-1.5 font-medium">Label</th>
                  <th className="px-3 py-1.5 font-medium">Role</th>
                  <th className="px-3 py-1.5 font-medium">Language</th>
                  <th className="px-3 py-1.5 font-medium">Source</th>
                  <th className="px-3 py-1.5 text-right font-medium">~Clips</th>
                </tr>
              </thead>
              <tbody>
                {m.labels!.map((l) => (
                  <tr key={l.name} className="border-b border-line/60 last:border-0">
                    <td className="px-3 py-1.5 font-mono text-ink-1">{l.name}</td>
                    <td className="px-3 py-1.5 text-ink-2">{l.role}</td>
                    <td className="px-3 py-1.5 text-ink-2">{l.language ?? '—'}</td>
                    <td className="px-3 py-1.5 text-ink-2">{l.source ?? '—'}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-ink-2">
                      {perLabel || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {m.recipe && (
          <div className="mt-3 text-[11px] leading-relaxed text-ink-3">
            <span className="font-medium text-ink-2">Recipe:</span>{' '}
            {m.recipe.engine}
            {m.recipe.phrases?.length ? ` · ${m.recipe.phrases.join(', ')}` : ''}
            {m.recipe.languages?.length ? ` · ${m.recipe.languages.join(', ')}` : ''}
            {m.recipe.seed !== undefined ? ` · seed ${m.recipe.seed}` : ''}
          </div>
        )}
      </section>

      {/* Provenance — the export-gate input (#210). */}
      <section className="rounded-xl border border-line bg-surface-2 p-4">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-3">Provenance</h4>
        <ul className="mt-2 space-y-2">
          {m.provenance.map((p) => (
            <li key={p.name} className="rounded-lg border border-line bg-surface-1 px-3 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-ink-1">{p.name}</span>
                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
                    p.commercialUse
                      ? 'bg-emerald-500/10 text-emerald-600'
                      : 'bg-amber-500/10 text-amber-700',
                  )}
                >
                  {p.commercialUse ? 'commercial use' : 'non-commercial'}
                </span>
              </div>
              <div className="mt-1 text-[11px] text-ink-3">
                {p.license}
                {p.source && (
                  <>
                    {' '}
                    · <span className="font-mono">{p.source}</span>
                  </>
                )}
              </div>
              {!p.commercialUse && (
                <p className="mt-1 text-[11px] leading-relaxed text-amber-700">
                  A model trained on this dataset inherits the restriction — the export gate
                  blocks commercial bundles (#210).
                </p>
              )}
            </li>
          ))}
        </ul>
      </section>

      {/* Storage. */}
      <section className="rounded-xl border border-line bg-surface-2 p-4">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-3">Storage</h4>
        <dl className="mt-2 grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
          <div className="flex justify-between gap-3">
            <dt className="text-ink-3">Backend</dt>
            <dd className="truncate font-mono text-ink-1" title={m.storage?.backend}>
              {m.storage?.backend ?? (dataset.origin === 'local' ? 'browser-local' : '—')}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink-3">Cloud</dt>
            <dd className="truncate font-mono text-ink-1" title={m.storage?.cloud}>
              {m.storage?.cloud ?? dataset.cloud ?? '—'}
            </dd>
          </div>
          {m.storage?.url && (
            <div className="flex justify-between gap-3 sm:col-span-2">
              <dt className="text-ink-3">URL</dt>
              <dd className="truncate font-mono text-brand-11" title={m.storage.url}>
                {m.storage.url}
              </dd>
            </div>
          )}
          <div className="flex justify-between gap-3">
            <dt className="text-ink-3">Size</dt>
            <dd className="font-mono text-ink-1">{formatBytes(dataset.sizeBytes) || '—'}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink-3">Created</dt>
            <dd className="font-mono text-ink-1">
              {dataset.createdAtMs ? new Date(dataset.createdAtMs).toLocaleString() : '—'}
            </dd>
          </div>
        </dl>
      </section>

      {/* Quality report — what the manifest carries today; the health-check
          job (clip quality, silence, duplication, balance) is #209. */}
      <section className="rounded-xl border border-line bg-surface-2 p-4">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-3">Quality report</h4>
        <dl className="mt-2 grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
          <div className="flex justify-between gap-3">
            <dt className="text-ink-3">Role coverage</dt>
            <dd className="font-mono text-ink-1">
              {dataset.roles.length ? dataset.roles.join(' / ') : '—'}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink-3">Wake-word (positive) labels</dt>
            <dd className="font-mono text-ink-1">
              {dataset.roles.includes('positive') ? 'yes' : 'no'}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink-3">Unknowns / noise coverage</dt>
            <dd className="font-mono text-ink-1">
              {[dataset.roles.includes('unknown') && 'unknowns', dataset.roles.includes('noise') && 'noise']
                .filter(Boolean)
                .join(' / ') || '—'}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink-3">Commercial use</dt>
            <dd className="font-mono text-ink-1">{dataset.commercialUse ? 'yes' : 'no'}</dd>
          </div>
        </dl>
        <p className="mt-3 text-[11px] leading-relaxed text-ink-3">
          This manifest-level summary is rendered today. The full health check — per-label clip
          quality, silence/duplicate detection, sample-rate drift, label balance — ships as a
          dedicated job (issue #209).
        </p>
      </section>
    </div>
  )
}
