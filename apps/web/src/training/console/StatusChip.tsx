/**
 * Training console — job status chip (issue #105).
 */

import type { HistoryJob } from '@wake-studio/module-training'
import { cn } from '../../components/cn'

export const STATUS_STYLE: Record<HistoryJob['status'], string> = {
  queued: 'bg-amber-500/15 text-amber-700',
  running: 'bg-brand-9/15 text-brand-11',
  paused: 'bg-sky-500/15 text-sky-700',
  succeeded: 'bg-emerald-500/15 text-emerald-700',
  failed: 'bg-danger/15 text-danger',
  canceled: 'bg-surface-3 text-ink-3',
}

export function StatusChip({ status }: { status: HistoryJob['status'] }) {
  return (
    <span
      className={cn(
        'rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide',
        STATUS_STYLE[status],
      )}
    >
      {status}
    </span>
  )
}