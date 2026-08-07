/**
 * Per-stage persistence toggle (epic #53 UX overhaul).
 *
 * One stage's persistence switch lives inside that module's own config panel
 * (Source -> raw input, NS -> NS output, KWS -> KWS output). Writes the same
 * workspace-snapshot `persistence` key the capture flow reads.
 */

import type { PersistStageId, WorkspaceConfig } from '../workspace/types'

interface Props {
  stageId: PersistStageId
  label: string
  config?: WorkspaceConfig['persistence']
  onChange: (next: WorkspaceConfig['persistence']) => void
}

export function PersistenceStageToggle({ stageId, label, config, onChange }: Props) {
  const enabled = config?.[stageId]?.enabled ?? false
  const maxSeconds = config?.[stageId]?.maxSeconds

  const setEnabled = (v: boolean) => {
    onChange({
      raw: config?.raw ?? { enabled: false },
      ns: config?.ns ?? { enabled: false },
      kws: config?.kws ?? { enabled: false },
      [stageId]: { enabled: v, maxSeconds },
    })
  }

  const setMax = (value: string) => {
    const n = Number(value)
    const next = value === '' || !Number.isFinite(n) || n <= 0 ? undefined : n
    onChange({
      raw: config?.raw ?? { enabled: false },
      ns: config?.ns ?? { enabled: false },
      kws: config?.kws ?? { enabled: false },
      [stageId]: { enabled, maxSeconds: next },
    })
  }

  return (
    <label className="flex flex-wrap items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={enabled}
        onChange={(e) => setEnabled(e.target.checked)}
        className="h-3.5 w-3.5 rounded accent-brand-500"
      />
      <span className="text-ink-2">{label}</span>
      {enabled && (
        <span className="flex items-center gap-1 text-xs text-ink-3">
          max
          <input
            type="number"
            min={0}
            placeholder="∞"
            value={maxSeconds ?? ''}
            onChange={(e) => setMax(e.target.value)}
            className="h-6 w-14 rounded border border-line bg-surface-3 px-1.5 font-mono text-xs text-ink-1"
          />
          s
        </span>
      )}
    </label>
  )
}
