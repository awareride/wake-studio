/**
 * Pipeline-shaped stage cards (epic #53 UX).
 *
 * Source → AEC → BSS → NS → KWS as five evenly-distributed cards. Each card
 * is a stage node: a colored accent strip + big label top-left (blended with
 * the card), a compact core-config preview, and an enable/disable pill
 * (bypass for AEC/BSS/NS, on/off for KWS). Clicking a card selects its
 * config panel (rendered below by the workspace).
 */

import * as React from 'react'
import { cn } from './cn'

export type PipelineTabId = 'source' | 'aec' | 'bss' | 'ns' | 'kws'

export interface StageCardDef {
  id: PipelineTabId
  /** Card label, e.g. "Source". */
  label: string
  /** Compact core-config preview shown under the label. */
  preview: React.ReactNode
  /** Accent color (hex) — strip, big label and glyph. */
  color: string
  /** Whether the stage is enabled (On). */
  enabled: boolean
  /** Enable/disable handler (undefined = no toggle, e.g. Source). */
  onToggleEnabled?: () => void
  /** Extra badge text on the card (e.g. "persist"). */
  badge?: string
}

interface Props {
  active: PipelineTabId
  onSelect: (id: PipelineTabId) => void
  cards: StageCardDef[]
}

const GLYPHS: Record<PipelineTabId, string> = {
  source: '⌗',
  aec: '≈',
  bss: '⇄',
  ns: '∿',
  kws: '♪',
}

export function PipelineTabs({ active, onSelect, cards }: Props) {
  return (
    <div className="flex flex-wrap gap-2">
      {cards.map((card) => {
        const selected = active === card.id
        return (
          <div
            key={card.id}
            role="button"
            tabIndex={0}
            aria-label={`${card.label} config`}
            aria-pressed={selected}
            onClick={() => onSelect(card.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onSelect(card.id)
              }
            }}
            className={cn(
              'flex min-w-0 flex-1 cursor-pointer flex-col overflow-hidden rounded-xl border transition-all',
              selected
                ? 'border-brand-400/60 bg-surface-2 shadow-lg shadow-brand-500/5'
                : 'border-line bg-surface-2 hover:border-line-2 hover:bg-surface-3',
              !card.enabled && 'opacity-60',
            )}
          >
            {/* Color accent strip (top edge, blends into the card). */}
            <div
              className="h-1.5"
              style={{
                background: `linear-gradient(90deg, ${card.color}, ${card.color}33)`,
                opacity: card.enabled ? 1 : 0.3,
              }}
            />
            <div className="flex flex-1 flex-col p-2.5">
              {/* Label row: big text top-left, enable/disable pill top-right. */}
              <div className="flex items-start justify-between gap-1.5">
                <div className="flex min-w-0 items-baseline gap-1.5">
                  <span
                    className="text-base font-bold leading-none"
                    style={{ color: card.color }}
                  >
                    {GLYPHS[card.id]}
                  </span>
                  <span className="truncate text-sm font-bold tracking-tight text-ink-1">
                    {card.label}
                  </span>
                  {card.badge && (
                    <span className="shrink-0 rounded bg-emerald-500/15 px-1 py-0.5 text-[8px] font-semibold uppercase tracking-wider text-emerald-300">
                      {card.badge}
                    </span>
                  )}
                </div>
                {card.onToggleEnabled && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      card.onToggleEnabled?.()
                    }}
                    aria-label={`${card.label} toggle`}
                    aria-pressed={card.enabled}
                    className={cn(
                      'shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest transition-colors',
                      card.enabled
                        ? 'bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25'
                        : 'bg-surface-4 text-ink-3 hover:bg-surface-3',
                    )}
                  >
                    {card.enabled ? 'On' : 'Off'}
                  </button>
                )}
              </div>

              {/* Core config preview — bottom-aligned across equal-height cards. */}
              <div className="mt-auto pt-1.5 text-[11px] leading-snug text-ink-3">
                {card.preview}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
