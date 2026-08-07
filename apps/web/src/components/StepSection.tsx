/**
 * Step section (epic #53 P7, plan §8.1).
 *
 * One collapsible step of the Phase 1 "Configure" flow: numbered badge +
 * title in the header row, collapsible body. Zero-dependency disclosure
 * (button + conditional render) — no Radix needed for a simple accordion.
 */

import * as React from 'react'
import { cn } from './cn'

interface Props {
  /** Step id shown in the badge, e.g. "A". */
  step: string
  title: string
  /** Optional one-line description under the title. */
  description?: string
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}

export function StepSection({
  step,
  title,
  description,
  open,
  onToggle,
  children,
}: Props) {
  return (
    <section className="overflow-hidden rounded-xl border border-line bg-surface-2">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-3"
      >
        <span
          className={cn(
            'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold',
            open ? 'bg-brand-500 text-ink-1' : 'bg-surface-4 text-ink-3',
          )}
        >
          {step}
        </span>
        <span className="flex-1">
          <span className="text-sm font-semibold text-ink-1">{title}</span>
          {description && (
            <span className="ml-2 hidden text-xs text-ink-3 sm:inline">
              {description}
            </span>
          )}
        </span>
        <svg
          viewBox="0 0 24 24"
          className={cn(
            'h-3.5 w-3.5 text-ink-3 transition-transform',
            open && 'rotate-90',
          )}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m9 18 6-6-6-6" />
        </svg>
      </button>
      {open && <div className="space-y-4 px-4 pb-5 pt-1">{children}</div>}
    </section>
  )
}
