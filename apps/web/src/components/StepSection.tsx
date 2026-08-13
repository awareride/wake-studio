/**
 * Step section (epic #53 P7, plan §8.1).
 *
 * One collapsible step of the Phase 1 "Configure" flow: numbered badge +
 * title in the header row, collapsible body. Zero-dependency disclosure
 * (button + conditional render) — no Radix needed for a simple accordion.
 */

import * as React from 'react'
import { ChevronRightIcon } from '@radix-ui/react-icons'
import { Button } from '@radix-ui/themes'
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
      <Button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        variant="ghost"
        size="2"
        className="w-full justify-start gap-3 px-4 text-left"
      >
        <span
          className={cn(
            'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold',
            open ? 'bg-brand-9 text-ink-1' : 'bg-surface-4 text-ink-3',
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
        <ChevronRightIcon
          className={cn(
            'h-3.5 w-3.5 text-ink-3 transition-transform',
            open && 'rotate-90',
          )}
        />
      </Button>
      {open && <div className="space-y-4 px-4 pb-5 pt-1">{children}</div>}
    </section>
  )
}
