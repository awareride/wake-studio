/**
 * Pipeline-shaped config tabs (epic #53 UX overhaul).
 *
 * Not a regular tab bar: Source → AEC → BSS → NS → KWS rendered as a flow of
 * nodes joined by arrows. Each node shows the module's label plus a compact
 * "core preview" of its current config (e.g. "Mic · default", "Bypassed",
 * "openwakeword · idle") so you can see what's configured without opening the
 * module. The active node's config panel renders below.
 */

import * as React from 'react'
import { cn } from './cn'

export type PipelineTabId = 'source' | 'aec' | 'bss' | 'ns' | 'kws'

export interface PipelineTabItem {
  id: PipelineTabId
  /** Node label, e.g. "Source". */
  label: string
  /** Compact config preview shown on the node. */
  preview: React.ReactNode
  /** Optional badge (e.g. "persist" when the stage persistence is on). */
  badge?: string
  disabled?: boolean
}

interface Props {
  active: PipelineTabId
  onSelect: (id: PipelineTabId) => void
  tabs: PipelineTabItem[]
}

const ORDER: PipelineTabId[] = ['source', 'aec', 'bss', 'ns', 'kws']

export function PipelineTabs({ active, onSelect, tabs }: Props) {
  const byId = new Map(tabs.map((t) => [t.id, t]))
  const ordered = ORDER.map((id) => byId.get(id)).filter(
    (t): t is PipelineTabItem => Boolean(t),
  )

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        {ordered.map((tab, i) => (
          <React.Fragment key={tab.id}>
            {i > 0 && (
              <svg
                viewBox="0 0 24 24"
                className="h-3.5 w-3.5 shrink-0 text-ink-3/50"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m9 18 6-6-6-6" />
              </svg>
            )}
            <button
              type="button"
              onClick={() => !tab.disabled && onSelect(tab.id)}
              disabled={tab.disabled}
              aria-pressed={active === tab.id}
              aria-label={`${tab.label} config`}
              className={cn(
                'group flex min-w-0 flex-col items-start gap-0.5 rounded-xl border px-3 py-2 text-left transition-colors disabled:opacity-40',
                active === tab.id
                  ? 'border-brand-400/60 bg-brand-500/10'
                  : 'border-line bg-surface-2 hover:bg-surface-3',
              )}
            >
              <span className="flex w-full items-center gap-1.5">
                <span
                  className={cn(
                    'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold',
                    active === tab.id
                      ? 'bg-brand-500 text-ink-1'
                      : 'bg-surface-4 text-ink-3',
                  )}
                >
                  {i + 1}
                </span>
                <span
                  className={cn(
                    'text-sm font-semibold',
                    active === tab.id ? 'text-brand-200' : 'text-ink-1',
                  )}
                >
                  {tab.label}
                </span>
                {tab.badge && (
                  <span className="rounded bg-emerald-500/15 px-1 py-0.5 text-[9px] font-medium uppercase tracking-wider text-emerald-300">
                    {tab.badge}
                  </span>
                )}
              </span>
              <span className="ml-6.5 max-w-40 truncate text-[11px] text-ink-3">
                {tab.preview}
              </span>
            </button>
          </React.Fragment>
        ))}
      </div>
    </div>
  )
}
