/**
 * Mini KWS score curve (epic #53 UX).
 *
 * The KWS stage card's preview: a compact version of the score curve (raw +
 * smoothed + threshold) drawn from the shared live score history — same
 * renderer as the full curve, sized like the waveform previews of the other
 * stage cards.
 */

import { useEffect, useRef } from 'react'
import { drawScoreCurve } from './viz/ScoreCurve'
import { useLiveKws } from '../workspace/live'

export function MiniScoreCurve() {
  const { historyRef, threshold, words } = useLiveKws()
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    let rafId: number
    const render = () => {
      const canvas = canvasRef.current
      if (canvas) {
        const ctx = canvas.getContext('2d')
        if (ctx) drawScoreCurve(ctx, canvas, historyRef.current, threshold, words)
      }
      rafId = requestAnimationFrame(render)
    }
    rafId = requestAnimationFrame(render)
    return () => cancelAnimationFrame(rafId)
  }, [historyRef, threshold, words])

  return (
    <canvas
      ref={canvasRef}
      width={256}
      height={64}
      className="h-16 w-full rounded bg-surface-3"
    />
  )
}
