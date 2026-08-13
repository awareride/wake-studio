/**
 * Training console — inline guide (issue #105).
 *
 * The guide is mixed into each wizard step: a compact, always-visible help
 * box with the step's guidance text (from the training module core
 * STEP_DEFS). No drawer, no dedicated guide tab.
 */

import { cn } from '../../components/cn'

export interface InlineGuideProps {
  title?: string
  lines: string[]
  className?: string
}

export function InlineGuide({ title = 'How this step works', lines, className }: InlineGuideProps) {
  if (lines.length === 0) return null
  return (
    <div
      className={cn(
        'rounded-lg border border-brand-500/20 bg-brand-500/5 px-3 py-2.5',
        className,
      )}
    >
      <div className="text-[11px] font-semibold uppercase tracking-wide text-brand-700">
        {title}
      </div>
      <ul className="mt-1.5 space-y-1">
        {lines.map((line, i) => (
          <li key={i} className="flex gap-1.5 text-xs leading-relaxed text-ink-2">
            <span aria-hidden className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-brand-500/60" />
            {line}
          </li>
        ))}
      </ul>
    </div>
  )
}