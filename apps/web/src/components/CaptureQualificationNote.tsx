/**
 * Capture qualification readout (issue #246).
 *
 * A stereo-looking stream is not evidence that two independent microphones
 * reached the processor: the OS may have downmixed to mono, duplicated one
 * channel, or reordered them. Any of those silently destroys spatial
 * processing while the UI implies an array exists. This component is where the
 * user finds out which case they are in — before any spatial stage can be
 * enabled, and with the reason stated, not a silent fallback.
 *
 * The verdict comes from the live probe while the pipeline runs and from the
 * per-device cache otherwise; a cached entry is a convenience for the UI, never
 * an authorization to enable spatial processing (the live probe decides that).
 */

import type { QualificationResult } from '@wake-studio/module-afe-graph'
import { Button } from '@radix-ui/themes'
import { useT } from '../i18n'

const STYLES: Record<
  QualificationResult['level'],
  { badge: string; label: string }
> = {
  qualified: {
    badge: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
    label: 'Qualified',
  },
  degraded: {
    badge: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
    label: 'Degraded',
  },
  unsupported: {
    badge: 'border-red-500/40 bg-red-500/10 text-red-300',
    label: 'Unsupported',
  },
}

export function CaptureQualificationNote({
  qualification,
  running,
  stale,
  onRequalify,
}: {
  /** Live verdict while running; the cached one otherwise; null = unknown. */
  qualification: QualificationResult | null
  running: boolean
  /** True when the shown verdict is a cached one, not the current capture. */
  stale: boolean
  onRequalify: () => void
}) {
  const t = useT()

  return (
    <div className="mt-2 rounded-lg border border-line bg-surface-3 p-3 text-[11px] text-ink-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-ink-1">{t('Array qualification')}</span>
        {qualification ? (
          <span
            className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${STYLES[qualification.level].badge}`}
          >
            {t(STYLES[qualification.level].label)}
          </span>
        ) : (
          <span className="rounded-full border border-line px-2 py-0.5 text-[10px] text-ink-3">
            {running ? t('Measuring…') : t('Not measured yet')}
          </span>
        )}
        {stale && qualification && (
          <span className="text-[10px] text-ink-3">
            {t('last measured capture')}
          </span>
        )}
        {running && (
          <Button size="1" variant="soft" onClick={onRequalify} className="ml-auto">
            {t('Re-measure')}
          </Button>
        )}
      </div>

      {qualification ? (
        <ul className="mt-2 list-disc space-y-0.5 pl-4">
          {qualification.reasons.length > 0 ? (
            qualification.reasons.map((r) => <li key={r}>{r}</li>)
          ) : (
            <li>
              {t(
                'No disqualifying signature found — spatial stages may be enabled. This does not prove two physical microphones.',
              )}
            </li>
          )}
        </ul>
      ) : (
        <p className="mt-2">
          {t(
            'Start the pipeline to measure this capture: it needs a few frames of real audio before it can tell an array from a duplicated stereo stream.',
          )}
        </p>
      )}

      <p className="mt-2 text-[10px] text-ink-3">
        {t(
          'A 2-element array cannot give 360° coverage, and a stereo stream that turns out to be one duplicated channel leaves spatial processing disabled with the pipeline on mono pass-through.',
        )}
      </p>
    </div>
  )
}
