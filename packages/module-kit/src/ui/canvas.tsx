/**
 * module-kit ui - canvas visualizations.
 *
 * Spec-driven `status` renderers (docs/module-spec.md §3 StatusRenderer):
 *   - bar      -> UiBar (VAD / level meter)
 *   - waveform -> UiWaveform (raw PCM / denoised comparison)
 *   - curve    -> UiCurve (score over time)
 *
 * These are self-contained, requestAnimationFrame-free (callers own the loop
 * via `data` updates) and styled to match the dark brand theme.
 */

import { useEffect, useRef } from 'react'

function useCanvas(
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  deps: unknown[],
) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    const { width, height } = canvas.getBoundingClientRect()
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
    ctx.scale(dpr, dpr)
    draw(ctx, width, height)
  }, deps)
  return ref
}

// ---------------------------------------------------------------------------
// Bar (VAD / level meter)
// ---------------------------------------------------------------------------

export interface UiBarProps {
  /** 0..1 */
  value: number
  label?: string
  height?: number
  /** Color when above this threshold. */
  threshold?: number
  className?: string
}

export function UiBar({ value, label, height = 6, threshold = 0.5, className }: UiBarProps) {
  const pct = Math.max(0, Math.min(1, value)) * 100
  const over = value >= threshold
  return (
    <div className={className}>
      {label && <div className="mb-1 text-xs text-ink-3">{label}</div>}
      <div
        className="relative w-full overflow-hidden rounded-full bg-surface-3"
        style={{ height }}
      >
        <div
          className={`h-full rounded-full transition-all duration-100 ${
            over ? 'bg-emerald-500' : 'bg-brand-9'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Waveform (raw PCM)
// ---------------------------------------------------------------------------

export interface UiWaveformProps {
  /** PCM samples (Float32Array or number[]). */
  data: ArrayLike<number>
  /** Compare a second series (e.g. denoised) - drawn as overlay. */
  overlay?: ArrayLike<number>
  height?: number
  color?: string
  overlayColor?: string
  className?: string
}

/** Center-line waveform; optional overlay series (e.g. before/after). */
export function UiWaveform({
  data,
  overlay,
  height = 64,
  color = '#38bdf8',
  overlayColor = '#34d399',
  className,
}: UiWaveformProps) {
  const draw = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    ctx.clearRect(0, 0, w, h)
    const mid = h / 2

    const paint = (series: ArrayLike<number>, c: string) => {
      ctx.strokeStyle = c
      ctx.lineWidth = 1.5
      ctx.beginPath()
      const n = series.length
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * w
        const y = mid - series[i] * (h / 2 - 2)
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
    }

    // Overlay (input) first, then main (output) on top.
    if (overlay) paint(overlay, overlayColor)
    paint(data, color)
    // Center line.
    ctx.strokeStyle = 'rgba(148,163,184,0.15)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, mid)
    ctx.lineTo(w, mid)
    ctx.stroke()
  }
  const ref = useCanvas(draw, [data, overlay, color, overlayColor])
  return <canvas ref={ref} className={className} style={{ width: '100%', height }} />
}

// ---------------------------------------------------------------------------
// Curve (score / VAD over time)
// ---------------------------------------------------------------------------

export interface UiCurveProps {
  /** History of values [0..1]; newest last. */
  data: ArrayLike<number>
  /** Optional threshold line to draw. */
  threshold?: number
  height?: number
  color?: string
  className?: string
}

export function UiCurve({ data, threshold, height = 64, color = '#38bdf8', className }: UiCurveProps) {
  const draw = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    ctx.clearRect(0, 0, w, h)
    // Threshold line.
    if (threshold != null) {
      ctx.strokeStyle = 'rgba(251,191,36,0.5)'
      ctx.setLineDash([4, 4])
      ctx.lineWidth = 1
      const y = h - threshold * h
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(w, y)
      ctx.stroke()
      ctx.setLineDash([])
    }
    // Data.
    ctx.strokeStyle = color
    ctx.lineWidth = 1.5
    ctx.beginPath()
    const n = data.length
    for (let i = 0; i < n; i++) {
      const x = (i / Math.max(1, n - 1)) * w
      const y = h - data[i] * h
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
  const ref = useCanvas(draw, [data, threshold, color])
  return <canvas ref={ref} className={className} style={{ width: '100%', height }} />
}
