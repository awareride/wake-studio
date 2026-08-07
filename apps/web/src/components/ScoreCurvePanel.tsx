/**
 * Phase 2 — KWS score curve (epic #53 P7, plan §8.2).
 *
 * Renders the live score history (written by the KWS panel's engine.onScore
 * into the shared live context) with the current detection threshold. The
 * history is a ref, so this canvas polls it in its rAF loop — no re-renders.
 */

import { useEffect, useRef } from 'react'
import { drawScoreCurve } from './viz/ScoreCurve'
import { useLiveKws } from '../workspace/live'

export function ScoreCurvePanel({ running }: { running: boolean }) {
  const { historyRef, threshold } = useLiveKws()
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!running) return
    let rafId: number

    const render = () => {
      const canvas = canvasRef.current
      if (canvas) {
        const ctx = canvas.getContext('2d')
        if (ctx) drawScoreCurve(ctx, canvas, historyRef.current, threshold)
      }
      rafId = requestAnimationFrame(render)
    }

    rafId = requestAnimationFrame(render)
    return () => cancelAnimationFrame(rafId)
  }, [running, threshold, historyRef])

  const last = historyRef.current.length > 0
    ? historyRef.current[historyRef.current.length - 1]
    : null

  return (
    <div className="rounded-xl border border-line bg-surface-2 p-5">
      <div className="mb-2 flex items-center justify-between text-xs text-ink-3">
        <span>Score curve (raw + smoothed + threshold)</span>
        <span className="font-mono">
          {last ? `score: ${last.smoothedScore.toFixed(3)}` : ''}
        </span>
      </div>
      <canvas
        ref={canvasRef}
        width={800}
        height={160}
        className="h-[160px] w-full rounded bg-surface-3"
      />
    </div>
  )
}
