/**
 * Shared stage-visualization components (issue #53 P1).
 *
 * Extracted from AFEPanel.tsx so the Workspace Phase-2 preview (and any
 * future surface) can reuse the same waveform / level / stage-card visuals
 * without duplicating canvas code. Pure presentation: no engine access, no
 * project/store access.
 */

import { memo, useEffect, useRef } from 'react'
import { cn } from '../cn'
import type { StageFrameData } from '@wake-studio/module-afe-graph'

/** A stage node id that carries per-stage metrics (AEC/BSS/NS today). */
export type VizStageId = 'aec' | 'bss' | 'ns'

interface StagePanelProps {
  id: VizStageId
  data?: StageFrameData
  isBypassed: boolean
  onToggleBypass: (id: VizStageId) => void
}

/** Memoized per-stage card. Only re-renders when this stage's data or bypass
 *  changes, not when other stages update (avoids 30fps re-renders of all 3). */
const STAGE_COLORS: Record<VizStageId, string> = {
  aec: '#818cf8',
  bss: '#a78bfa',
  ns: '#38bdf8',
}

export const StagePanel = memo(function StagePanel({
  id,
  data,
  isBypassed,
  onToggleBypass,
}: StagePanelProps) {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-line bg-surface-2">
      {/* Color accent strip — same look as the Setup stage cards. */}
      <div className="h-1 w-full" style={{ background: STAGE_COLORS[id] }} />
      <div className="flex flex-1 flex-col p-2.5">
        {/* Label top-left + enable/disable pill top-right (matches Setup). */}
        <div className="flex items-start justify-between gap-1.5">
          <span
            className="text-sm font-bold uppercase tracking-tight"
            style={{ color: STAGE_COLORS[id] }}
          >
            {id}
          </span>
          <button
            onClick={() => onToggleBypass(id)}
            aria-label={`${id} toggle`}
            aria-pressed={!isBypassed}
            className={cn(
              'shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest transition-colors',
              !isBypassed
                ? 'bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25'
                : 'bg-surface-4 text-ink-3 hover:bg-surface-3',
            )}
          >
            {!isBypassed ? 'On' : 'Off'}
          </button>
        </div>

        {/* Wave line (the live preview). */}
        <div className="mt-auto pt-1.5">
          <WaveformCanvas data={data?.waveform} />
        </div>

        {/* Thin footer: level + per-stage metric. */}
        <div className="mt-1.5 flex items-center gap-2 whitespace-nowrap text-[10px]">
          <span className="w-7 shrink-0 text-ink-3">Lvl</span>
          <div className="flex-1">
            <LevelBar db={data?.levelDb ?? -60} />
          </div>
          <span className="w-12 shrink-0 text-right font-mono text-ink-2">
            {data?.levelDb != null ? `${data.levelDb.toFixed(0)}dB` : '—'}
          </span>
        </div>
        {id === 'aec' && (
          <StageMetricRow
            label="Echo"
            value={data?.metrics?.erleDb}
            unit="dB"
            placeholder={isBypassed ? 'off' : '—'}
          />
        )}
        {id === 'bss' && (
          <StageMetricRow
            label="Sep"
            value={data?.metrics?.siSdrDb}
            unit="dB"
            placeholder={isBypassed ? 'off' : '—'}
          />
        )}
        {id === 'ns' && (
          <StageMetricRow
            label="VAD"
            value={
              data?.vadProbability != null
                ? data.vadProbability * 100
                : undefined
            }
            unit="%"
            placeholder="—"
          />
        )}
      </div>
    </div>
  )
})

/** One stage-specific metric row (AEC ERLE / BSS separation / NS VAD). */
export function StageMetricRow({
  label,
  value,
  unit,
  placeholder,
}: {
  label: string
  value?: number
  unit: string
  placeholder: string
}) {
  const shown = value != null ? `${value.toFixed(1)} ${unit}` : placeholder
  return (
    <div className="mt-2 flex items-center gap-2 text-xs whitespace-nowrap">
      <span className="w-12 shrink-0 text-ink-3">{label}</span>
      <div className="flex-1">
        <div className="h-2 overflow-hidden rounded-full bg-surface-4">
          <div
            className="h-full rounded-full bg-sky-400"
            style={{ width: `${Math.min(100, Math.max(0, value ?? 0))}%` }}
          />
        </div>
      </div>
      <span className="w-20 shrink-0 text-right font-mono text-ink-2">
        {shown}
      </span>
    </div>
  )
}

/** Mini Canvas waveform display. */
export function WaveformCanvas({ data }: { data?: Float32Array }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const w = canvas.width
    const h = canvas.height
    ctx.clearRect(0, 0, w, h)
    ctx.strokeStyle = '#38bdf8'
    ctx.lineWidth = 1.5
    ctx.beginPath()

    if (data && data.length > 0) {
      for (let i = 0; i < data.length; i++) {
        const x = (i / (data.length - 1)) * w
        const y = h / 2 - data[i] * (h / 2) * 0.9
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
    } else {
      ctx.moveTo(0, h / 2)
      ctx.lineTo(w, h / 2)
    }
    ctx.stroke()
  }, [data])

  return (
    <canvas
      ref={canvasRef}
      width={256}
      height={64}
      className="h-16 w-full rounded bg-surface-3"
    />
  )
}

/** Level meter (dBFS, -60 to 0). No transition: updates 30fps. */
export function LevelBar({ db }: { db: number }) {
  const pct = Math.max(0, Math.min(100, ((db + 60) / 60) * 100))
  const color =
    db > -6 ? 'bg-red-400' : db > -20 ? 'bg-amber-400' : 'bg-success'
  return (
    <div className="h-2 overflow-hidden rounded-full bg-surface-4">
      <div
        className={`h-full rounded-full ${color}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}
