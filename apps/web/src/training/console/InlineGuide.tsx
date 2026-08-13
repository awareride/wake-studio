/**
 * Training console — inline guide (issue #105).
 *
 * The guide is mixed into each wizard step as a collapsible tips box,
 * COLLAPSED by default — click the `>` to expand (human feedback round 6).
 */

import { useState } from 'react'
import { cn } from '../../components/cn'
import { IconChevronRight } from '../../components/icons'

export interface InlineGuideProps {
  title?: string
  lines: string[]
  className?: string
}

export function InlineGuide({
  title = 'How this step works',
  lines,
  className,
}: InlineGuideProps) {
  const [open, setOpen] = useState(false)
  if (lines.length === 0) return null
  return (
    <div className={cn('rounded-lg border border-brand-500/20 bg-brand-500/5', className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <IconChevronRight
          className={cn('h-3.5 w-3.5 text-brand-700 transition-transform', open && 'rotate-90')}
        />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-brand-700">
          {title}
        </span>
        {!open && <span className="text-[10px] text-ink-3">click to expand</span>}
      </button>
      {open && (
        <ul className="space-y-1 px-3 pb-2.5 pt-1">
          {lines.map((line, i) => (
            <li key={i} className="flex gap-1.5 text-xs leading-relaxed text-ink-2">
              <span aria-hidden className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-brand-500/60" />
              {line}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}