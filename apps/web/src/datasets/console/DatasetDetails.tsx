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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { sanitizeLabel } from '@wake-studio/module-dataset'
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
import {
  datasetIsListenable,
  listListenableClips,
  readListenableClipBytes,
  type DatasetClipRef,
} from '../listen'

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

      {/* Listen — the §8.3 per-clip player (ADR-045 #220), shown only for
          listensable dataset forms (local OPFS today). */}
      {datasetIsListenable(dataset) && <ListenSection dataset={dataset} />}

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

// ---------------------------------------------------------------------------
// Listen — §8.3 per-clip player (ADR-045, #220)
// ---------------------------------------------------------------------------

/** Cap the clip list rendered per label (the console stays light for large
 *  browser-local datasets; the full clip set is still listed + playable row by
 *  row via the archive tail — only the DOM is capped). */
const MAX_CLIPS_PER_LABEL = 100

/**
 * The per-clip audio player. Lists `audio/<label>/*.wav` clips from the
 * archive tail and plays ONE clip at a time through a single-entry OPFS read
 * (bounded to that clip — never a full archive download). One blob URL is
 * alive at a time and revoked on switch/stop/unmount.
 */
function ListenSection({ dataset }: { dataset: ConsoleDataset }) {
  const [clips, setClips] = useState<DatasetClipRef[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [label, setLabel] = useState<string | null>(null)
  const [playing, setPlaying] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const urlRef = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setClips(null)
    setPlaying(null)
    setError(null)
    void listListenableClips(dataset)
      .then((c) => {
        if (cancelled) return
        setClips(c)
        setLabel((prev) => prev ?? c[0]?.label ?? null)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [dataset])

  // Revoke the live blob URL on unmount.
  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    },
    [],
  )

  /** Pretty label name: map the sanitized folder back to the manifest phrase. */
  const labelName = useCallback(
    (folder: string) => {
      const match = dataset.manifest.labels?.find((l) => sanitizeLabel(l.name) === folder)
      return match?.name ?? folder
    },
    [dataset.manifest.labels],
  )

  const stop = useCallback(() => {
    audioRef.current?.pause()
    audioRef.current = null
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current)
      urlRef.current = null
    }
    setPlaying(null)
  }, [])

  const play = useCallback(
    async (path: string) => {
      if (playing === path) {
        stop()
        return
      }
      stop()
      try {
        const bytes = await readListenableClipBytes(dataset, path)
        const url = URL.createObjectURL(
          new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'audio/wav' }),
        )
        urlRef.current = url
        const audio = new Audio(url)
        audioRef.current = audio
        audio.onended = () => stop()
        audio.onerror = () => {
          stop()
          setError('Could not play this clip.')
        }
        setError(null)
        setPlaying(path)
        await audio.play()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        setPlaying(null)
      }
    },
    [playing, dataset, stop],
  )

  const byLabel = useMemo(() => {
    const groups = new Map<string, DatasetClipRef[]>()
    for (const clip of clips ?? []) {
      const list = groups.get(clip.label) ?? []
      list.push(clip)
      groups.set(clip.label, list)
    }
    return [...groups.entries()]
  }, [clips])

  const activeClips = byLabel.find(([folder]) => folder === label)?.[1] ?? []

  return (
    <section className="rounded-xl border border-line bg-surface-2 p-4">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-3">Listen</h4>

      {error && <p className="mt-2 text-[11px] text-red-600">{error}</p>}
      {!error && clips === null && (
        <p className="mt-2 text-[11px] text-ink-3">Reading clips from the archive tail…</p>
      )}
      {!error && clips?.length === 0 && (
        <p className="mt-2 text-[11px] text-ink-3">No audio clips in this dataset.</p>
      )}

      {byLabel.length > 0 && (
        <div className="mt-3 space-y-3">
          {/* Label chips. */}
          <div className="flex flex-wrap gap-1.5">
            {byLabel.map(([folder]) => (
              <button
                key={folder}
                type="button"
                onClick={() => {
                  setLabel(folder)
                  setPlaying(null)
                }}
                className={cn(
                  'rounded-full border px-2.5 py-0.5 text-[11px] transition-colors',
                  label === folder
                    ? 'border-brand-7 bg-brand-9 text-white'
                    : 'border-line bg-surface-1 text-ink-2 hover:border-brand-7',
                )}
              >
                {labelName(folder)}
              </button>
            ))}
          </div>

          {/* Clips of the active label (capped rows; single-clip reads). */}
          <ol className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface-1">
            {activeClips.slice(0, MAX_CLIPS_PER_LABEL).map((clip, i) => (
              <li key={clip.path} className="flex items-center gap-2 px-2.5 py-1.5">
                <span className="w-8 shrink-0 text-right font-mono text-[10px] text-ink-3">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink-2" title={clip.path}>
                  {clip.name}
                </span>
                <button
                  type="button"
                  onClick={() => void play(clip.path)}
                  aria-label={playing === clip.path ? `Stop ${clip.name}` : `Play ${clip.name}`}
                  className={cn(
                    'shrink-0 rounded-md border px-2 py-0.5 text-[11px] transition-colors',
                    playing === clip.path
                      ? 'border-amber-7 bg-amber-9 text-white'
                      : 'border-line bg-surface-2 text-ink-1 hover:border-brand-7',
                  )}
                >
                  {playing === clip.path ? '■ stop' : '▶ play'}
                </button>
              </li>
            ))}
          </ol>
          {activeClips.length > MAX_CLIPS_PER_LABEL && (
            <p className="text-[10px] text-ink-3">
              …and {activeClips.length - MAX_CLIPS_PER_LABEL} more clips in “{labelName(label ?? '')}”.
            </p>
          )}

          <p className="text-[10px] leading-relaxed text-ink-3">
            Playback reads a single clip on demand — never the whole archive (§8.3).
          </p>
        </div>
      )}
    </section>
  )
}
