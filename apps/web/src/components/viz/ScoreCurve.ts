/**
 * Shared KWS score-curve renderer (issue #53 P1).
 *
 * Extracted from KWSPanel.tsx so the Workspace Phase-2 preview (and any
 * future surface) can draw the same raw/smoothed score + threshold curve
 * without duplicating canvas code.
 */

import type { KWSScoreSample } from '@wake-studio/module-kws-engine'

/** Draw the scrolling score curve with threshold line. */
export function drawScoreCurve(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  history: KWSScoreSample[],
  threshold: number,
): void {
  const w = canvas.width
  const h = canvas.height
  ctx.clearRect(0, 0, w, h)

  // Threshold line.
  ctx.strokeStyle = 'rgba(251,191,36,0.4)'
  ctx.lineWidth = 1
  ctx.setLineDash([4, 4])
  ctx.beginPath()
  const ty = h - threshold * h
  ctx.moveTo(0, ty)
  ctx.lineTo(w, ty)
  ctx.stroke()
  ctx.setLineDash([])

  if (history.length < 2) return

  const xStep = w / (HISTORY_MAX - 1)

  // Raw score (faint).
  ctx.strokeStyle = 'rgba(129,140,248,0.4)'
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let i = 0; i < history.length; i++) {
    const x = i * xStep
    const y = h - history[i].rawScore * h
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.stroke()

  // Smoothed score (bright).
  ctx.strokeStyle = '#38bdf8'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  for (let i = 0; i < history.length; i++) {
    const x = i * xStep
    const y = h - history[i].smoothedScore * h
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.stroke()

  // Highlight triggered regions.
  ctx.fillStyle = 'rgba(52,211,153,0.1)'
  for (let i = 0; i < history.length; i++) {
    if (history[i].triggered) {
      ctx.fillRect(i * xStep, 0, xStep + 1, h)
    }
  }
}

/** Time-axis history length the curve is drawn against (matches the panels). */
export const HISTORY_MAX = 300 // ~3 s at ~100 fps
