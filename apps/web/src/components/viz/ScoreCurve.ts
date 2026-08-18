/**
 * Shared KWS score-curve renderer (issue #53 P1).
 *
 * Extracted from KWSPanel.tsx so the Workspace Phase-2 preview (and any
 * future surface) can draw the same raw/smoothed score + threshold curve
 * without duplicating canvas code.
 */

import type { KWSScoreSample } from '@wake-studio/module-kws-engine'

/** Line colors for per-word curves (ADR-039 multi-word). */
const WORD_COLORS = [
  '#38bdf8',
  '#34d399',
  '#f472b6',
  '#fbbf24',
  '#a78bfa',
  '#f87171',
  '#2dd4bf',
]

/**
 * Draw the scrolling score curve with threshold line.
 *
 * When `words` is set and the samples carry `wordScores` (ADR-039), draw one
 * raw line per word; otherwise fall back to the single raw/smoothed pair.
 */
export function drawScoreCurve(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  history: KWSScoreSample[],
  threshold: number,
  words?: string[],
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

  const drawLine = (
    getY: (s: KWSScoreSample) => number,
    color: string,
    width: number,
  ) => {
    ctx.strokeStyle = color
    ctx.lineWidth = width
    ctx.beginPath()
    for (let i = 0; i < history.length; i++) {
      const x = i * xStep
      const y = h - getY(history[i]) * h
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
  }

  // Multi-word mode: one raw line per configured word.
  if (words && words.length > 0 && history[0].wordScores) {
    words.forEach((word, idx) => {
      const color = WORD_COLORS[idx % WORD_COLORS.length]
      drawLine((s) => s.wordScores?.[word] ?? 0, color, 1.5)
    })
    // Highlight triggered regions (shared by both modes).
    highlightTriggered(ctx, history, xStep, h)
    return
  }

  // Single-word mode: raw score (faint) + smoothed score (bright).
  drawLine((s) => s.rawScore, 'rgba(129,140,248,0.4)', 1)
  drawLine((s) => s.smoothedScore, '#38bdf8', 1.5)
  highlightTriggered(ctx, history, xStep, h)
}

/** Shade frames where the trigger condition was met. */
function highlightTriggered(
  ctx: CanvasRenderingContext2D,
  history: KWSScoreSample[],
  xStep: number,
  h: number,
): void {
  ctx.fillStyle = 'rgba(52,211,153,0.1)'
  for (let i = 0; i < history.length; i++) {
    if (history[i].triggered) {
      ctx.fillRect(i * xStep, 0, xStep + 1, h)
    }
  }
}

/** Time-axis history length the curve is drawn against (matches the panels). */
export const HISTORY_MAX = 300 // ~3 s at ~100 fps
