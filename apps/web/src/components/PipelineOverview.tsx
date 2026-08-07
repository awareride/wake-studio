import { useEffect, useRef, memo } from 'react'
import type { StageFrameData } from '@wake-studio/module-afe-graph'

interface Props {
  frameData: Record<string, StageFrameData>
  running: boolean
  latencyMs: number
  /** Source label for the flow's input node (e.g. 'MIC' / 'FILE'). */
  sourceLabel?: string
}

const HISTORY_MAX = 300 // ~10 s at 30 fps

interface HistoryPoint {
  aec: number
  bss: number
  ns: number
  vad: number
}

const STAGES = ['aec', 'bss', 'ns'] as const
const STAGE_COLORS: Record<string, string> = {
  aec: '#818cf8', // indigo-400
  bss: '#a78bfa', // violet-400
  ns: '#38bdf8', // sky-400
  kws: '#34d399', // emerald-400
}

export const PipelineOverview = memo(function PipelineOverview({ frameData, running, latencyMs, sourceLabel }: Props) {
  const historyRef = useRef<HistoryPoint[]>([])
  const scrollCanvasRef = useRef<HTMLCanvasElement>(null)

  // Push to history when frame data updates.
  useEffect(() => {
    if (!running) return
    const aec = frameData['aec']
    const bss = frameData['bss']
    const ns = frameData['ns']
    if (!aec && !bss && !ns) return
    historyRef.current.push({
      aec: aec?.levelDb ?? -60,
      bss: bss?.levelDb ?? -60,
      ns: ns?.levelDb ?? -60,
      vad: ns?.vadProbability ?? 0,
    })
    if (historyRef.current.length > HISTORY_MAX) {
      historyRef.current.shift()
    }
  }, [frameData, running])

  // Clear history when stopped.
  useEffect(() => {
    if (!running) {
      historyRef.current = []
    }
  }, [running])

  return (
    <div className="rounded-xl border border-line bg-surface-2 p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink-1">Pipeline overview</h3>
        {running && (
          <span
            className={`font-mono text-xs ${
              latencyMs > 150
                ? 'text-danger'
                : latencyMs > 100
                  ? 'text-warning'
                  : 'text-success'
            }`}
          >
            {latencyMs.toFixed(0)} ms
          </span>
        )}
      </div>

      {/* Flow diagram: source -> AEC -> BSS -> NS -> KWS -> output. */}
      <div className="mb-6 flex items-center justify-center gap-1">
        <FlowNode label={sourceLabel ?? 'INPUT'} color="#64748b" />
        {STAGES.map((id) => (
          <div key={id} className="flex items-center gap-1">
            <FlowArrow active={running} />
            <FlowNode
              label={id.toUpperCase()}
              color={STAGE_COLORS[id]}
              waveform={frameData[id]?.waveform}
            />
          </div>
        ))}
        <FlowArrow active={running} />
        <FlowNode label="KWS" color={STAGE_COLORS.kws} />
        <FlowArrow active={running} />
        <FlowNode label="OUTPUT" color="#64748b" />
      </div>

      {/* Scrolling level + VAD curve */}
      <div className="relative">
        <div className="mb-1 flex items-center justify-between text-xs text-ink-3">
          <span>Level (dBFS) + VAD · last ~10 s</span>
          <div className="flex gap-3">
            {STAGES.map((id) => (
              <span key={id} className="flex items-center gap-1">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: STAGE_COLORS[id] }}
                />
                {id.toUpperCase()}
              </span>
            ))}
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full bg-success" />
              VAD
            </span>
          </div>
        </div>
        <ScrollingCurve canvasRef={scrollCanvasRef} historyRef={historyRef} running={running} />
      </div>
    </div>
  )
})

/** A stage node in the flow diagram with a mini waveform. */
function FlowNode({
  label,
  color,
  waveform,
}: {
  label: string
  color: string
  waveform?: Float32Array
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const w = canvas.width
    const h = canvas.height
    ctx.clearRect(0, 0, w, h)
    ctx.strokeStyle = color
    ctx.lineWidth = 1.5
    ctx.beginPath()
    if (waveform && waveform.length > 0) {
      for (let i = 0; i < waveform.length; i++) {
        const x = (i / (waveform.length - 1)) * w
        const y = h / 2 - waveform[i] * (h / 2) * 0.9
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
    } else {
      ctx.moveTo(0, h / 2)
      ctx.lineTo(w, h / 2)
    }
    ctx.stroke()
  }, [waveform, color])

  return (
    <div className="flex flex-col items-center gap-1">
      <canvas
        ref={canvasRef}
        width={80}
        height={40}
        className="rounded bg-surface-3"
      />
      <span
        className="text-[10px] font-medium uppercase"
        style={{ color }}
      >
        {label}
      </span>
    </div>
  )
}

/** Animated arrow between flow nodes. */
function FlowArrow({ active }: { active: boolean }) {
  return (
    <div
      className={`h-0.5 w-6 rounded ${
        active
          ? 'animate-pulse bg-gradient-to-r from-transparent via-brand-400 to-transparent'
          : 'bg-slate-700'
      }`}
    />
  )
}

/** Scrolling level + VAD curve canvas. */
function ScrollingCurve({
  canvasRef,
  historyRef,
  running,
}: {
  canvasRef: React.RefObject<HTMLCanvasElement>
  historyRef: React.MutableRefObject<HistoryPoint[]>
  running: boolean
}) {
  useEffect(() => {
    if (!running) return
    let rafId: number

    const render = () => {
      const canvas = canvasRef.current
      if (!canvas) {
        rafId = requestAnimationFrame(render)
        return
      }
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        rafId = requestAnimationFrame(render)
        return
      }

      const w = canvas.width
      const h = canvas.height
      ctx.clearRect(0, 0, w, h)

      // Grid lines.
      ctx.strokeStyle = 'rgba(255,255,255,0.05)'
      ctx.lineWidth = 1
      for (let db = 0; db >= -60; db -= 20) {
        const y = h - ((db + 60) / 60) * h
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(w, y)
        ctx.stroke()
      }

      const history = historyRef.current
      if (history.length < 2) {
        rafId = requestAnimationFrame(render)
        return
      }

      const xStep = w / (HISTORY_MAX - 1)

      // Level curves for each stage.
      for (const id of STAGES) {
        ctx.strokeStyle = STAGE_COLORS[id]
        ctx.lineWidth = 1.5
        ctx.beginPath()
        for (let i = 0; i < history.length; i++) {
          const db = history[i][id]
          const x = i * xStep
          const y = h - ((db + 60) / 60) * h
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.stroke()
      }

      // VAD curve (filled area at the bottom).
      ctx.fillStyle = 'rgba(52,211,153,0.15)'
      ctx.strokeStyle = '#34d399'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(0, h)
      for (let i = 0; i < history.length; i++) {
        const vad = history[i].vad
        const x = i * xStep
        const y = h - vad * h * 0.4 // VAD uses bottom 40% of the canvas
        ctx.lineTo(x, y)
      }
      ctx.lineTo((history.length - 1) * xStep, h)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()

      rafId = requestAnimationFrame(render)
    }

    rafId = requestAnimationFrame(render)
    return () => cancelAnimationFrame(rafId)
  }, [running, canvasRef, historyRef])

  return (
    <canvas
      ref={canvasRef}
      width={800}
      height={120}
      className="h-[120px] w-full rounded bg-surface-3"
    />
  )
}
