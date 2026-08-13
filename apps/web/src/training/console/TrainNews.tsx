/**
 * Training console — train news (issue #105).
 *
 * A tips feed for the end user: "train succeeded", "train failed", "results
 * imported"… Derived from the recorded jobs (deriveNews — a pure projection,
 * no extra storage). Clicking an item opens that train's review.
 */

import { type TrainNewsItem } from '@wake-studio/module-training'
import { cn } from '../../components/cn'

export interface TrainNewsProps {
  items: TrainNewsItem[]
  onOpen: (jobId: string) => void
}

const KIND_DOT: Record<TrainNewsItem['kind'], string> = {
  started: 'bg-brand-500',
  succeeded: 'bg-emerald-500',
  imported: 'bg-emerald-500',
  failed: 'bg-danger',
  canceled: 'bg-ink-3',
}

function formatWhen(ms: number): string {
  const diff = Date.now() - ms
  if (diff < 60_000) return 'now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`
  return new Date(ms).toLocaleDateString()
}

export function TrainNews({ items, onOpen }: TrainNewsProps) {
  const visible = items.slice(0, 8)
  if (visible.length === 0) {
    return (
      <div className="px-4 pb-2 pt-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-3">Train news</h3>
        <p className="mt-1.5 text-[11px] leading-relaxed text-ink-3">
          Tips about your trains will show up here (successes, errors, imports).
        </p>
      </div>
    )
  }

  return (
    <div className="border-b border-line px-4 pb-3 pt-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-3">Train news</h3>
      <ul className="mt-2 space-y-1.5">
        {visible.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => onOpen(item.jobId)}
              className="group flex w-full items-start gap-2 rounded-md px-1 py-1 text-left transition-colors hover:bg-surface-2"
            >
              <span
                className={cn('mt-1 h-1.5 w-1.5 shrink-0 rounded-full', KIND_DOT[item.kind])}
                aria-hidden
              />
              <span className="min-w-0 flex-1 text-[11px] leading-snug text-ink-2 group-hover:text-ink-1">
                {item.message}
              </span>
              <span className="shrink-0 text-[10px] text-ink-3">{formatWhen(item.atMs)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}