/**
 * Pipeline-shaped stage cards (epic #53 UX).
 *
 * One shared StageCard visual used by BOTH modes so the Setup config cards
 * and the Live preview cards are identical in shape, size and behavior:
 *
 *   color accent strip · big blended glyph/label top-left · enable/disable
 *   pill top-right · bottom-aligned preview (config text in Setup, waveform
 *   in Live).
 *
 * PipelineTabs renders the five Setup cards (Source → … → KWS) with a
 * config preview + selection; the Live dashboard reuses StageCard directly
 * with a waveform preview.
 */

import * as React from 'react'
import { cn } from './cn'

export type PipelineTabId = 'source' | 'aec' | 'bss' | 'ns' | 'kws'

export interface StageCardDef {
  id: PipelineTabId
  /** Card label, e.g. "Source". */
  label: string
  /** Bottom-aligned preview content (config text / waveform). */
  preview: React.ReactNode
  /** Accent color (hex) — strip, big label and glyph. */
  color: string
  /** Whether the stage is enabled (On). */
  enabled: boolean
  /** Enable/disable handler (undefined = no toggle, e.g. Source). */
  onToggleEnabled?: () => void
  /** Extra badge on the label row (e.g. "persist"). */
  badge?: string
}

interface StageCardProps extends StageCardDef {
  glyph: string
  /** Selection state (Setup only; undefined for Live cards). */
  active?: boolean
  onSelect?: () => void
}

/** One stage card — identical in Setup and Live. */
export function StageCard({
  glyph,
  label,
  preview,
  color,
  enabled,
  onToggleEnabled,
  badge,
  active,
  onSelect,
}: StageCardProps) {
  return (
    <div
      role={onSelect ? 'button' : undefined}
      tabIndex={onSelect ? 0 : undefined}
      aria-label={`${label} config`}
      aria-pressed={active}
      onClick={onSelect}
      onKeyDown={
        onSelect
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onSelect()
              }
            }
          : undefined
      }
      className={cn(
        'flex min-w-0 flex-1 cursor-pointer flex-col overflow-hidden rounded-xl border transition-all',
        active
          ? 'border-brand-400/60 bg-surface-2 shadow-lg shadow-brand-500/5'
          : 'border-line bg-surface-2 hover:border-line-2 hover:bg-surface-3',
        !enabled && 'opacity-60',
        !onSelect && 'cursor-default',
      )}
    >
      {/* Color accent strip (top edge, blends into the card). */}
      <div
        className="h-1.5 w-full"
        style={{
          background: `linear-gradient(90deg, ${color}, ${color}33)`,
          opacity: enabled ? 1 : 0.3,
        }}
      />
      <div className="flex flex-1 flex-col p-2.5">
        {/* Label row: big text top-left, enable/disable pill top-right. */}
        <div className="flex items-start justify-between gap-1.5">
          <div className="flex min-w-0 items-baseline gap-1.5">
            <span
              className="text-base font-bold leading-none"
              style={{ color }}
            >
              {glyph}
            </span>
            <span className="truncate text-sm font-bold tracking-tight text-ink-1">
              {label}
            </span>
            {badge && (
              <span className="shrink-0 rounded bg-emerald-500/15 px-1 py-0.5 text-[8px] font-semibold uppercase tracking-wider text-emerald-300">
                {badge}
              </span>
            )}
          </div>
          {onToggleEnabled && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onToggleEnabled?.()
              }}
              aria-label={`${label} toggle`}
              aria-pressed={enabled}
              className={cn(
                'shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest transition-colors',
                enabled
                  ? 'bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25'
                  : 'bg-surface-4 text-ink-3 hover:bg-surface-3',
              )}
            >
              {enabled ? 'On' : 'Off'}
            </button>
          )}
        </div>

        {/* Bottom-aligned preview — fixed height so Setup and Live cards are
            identical in height; the waveform fills the area. */}
        <div className="mt-auto flex h-16 items-end overflow-hidden text-[11px] leading-snug text-ink-3">
          {preview}
        </div>
      </div>
    </div>
  )
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
      {cards.map((card) => (
        <StageCard
          key={card.id}
          {...card}
          glyph={GLYPHS[card.id]}
          active={active === card.id}
          onSelect={() => onSelect(card.id)}
        />
      ))}
    </div>
  )
}
