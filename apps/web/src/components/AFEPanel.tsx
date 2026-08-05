import { memo, useCallback, useEffect, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import type { AFEPipeline } from '../afe'
import { AFEPipeline as AFEPipelineClass } from '../afe'
import type { StageFrameData } from '../afe'
import { describeParameters } from '../afe'
import { UnifiedConfigPanel } from './UnifiedConfigPanel'
import { useProjectStageConfig } from '../projects'
import { PipelineOverview } from './PipelineOverview'
import { RecordReplay } from './RecordReplay'

interface AFEPanelProps {
  afeRef: MutableRefObject<AFEPipeline | null>
  onRunningChange: (running: boolean) => void
  /** Optional: external control (workspace pipeline canvas) to start/stop. */
  commandRef?: MutableRefObject<{ start: () => void; stop: () => void } | null>
}

export function AFEPanel({ afeRef, onRunningChange, commandRef }: AFEPanelProps) {
  const { projectConfig: projCfg, persist } = useProjectStageConfig('afe')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [latencyMs, setLatencyMs] = useState(0)
  const [frameData, setFrameData] = useState<Record<string, StageFrameData>>({})
  // Seed vizFps from the active project's AFE snapshot (falls back to 30).
  const [vizFps, setVizFps] = useState(projCfg?.vizFps ?? 30)
  const [bypass, setBypass] = useState({ aec: true, bss: true, ns: false })

  // Keep a ref to bypass so toggleBypass has a stable identity (for memo).
  const bypassRef = useRef(bypass)
  bypassRef.current = bypass

  const params = describeParameters()

  const handleStart = useCallback(async () => {
    setError(null)
    if (!afeRef.current) {
      afeRef.current = new AFEPipelineClass()
    }
    const p = afeRef.current
    p.onFrame((f) => {
      setFrameData((prev) => ({ ...prev, [f.stageId]: f }))
    })
    try {
      await p.start()
      setRunning(true)
      onRunningChange(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [afeRef, onRunningChange])

  const handleStop = useCallback(() => {
    afeRef.current?.stop()
    setRunning(false)
    onRunningChange(false)
    setFrameData({})
    setLatencyMs(0)
  }, [afeRef, onRunningChange])

  // Expose start/stop to the workspace pipeline canvas via commandRef.
  useEffect(() => {
    if (commandRef) {
      commandRef.current = { start: () => void handleStart(), stop: handleStop }
    }
  }, [commandRef, handleStart, handleStop])

  const toggleBypass = useCallback(
    (stageId: 'aec' | 'bss' | 'ns') => {
      const newVal = !bypassRef.current[stageId]
      setBypass((prev) => ({ ...prev, [stageId]: newVal }))
      afeRef.current?.setBypassed(stageId, newVal)
    },
    [afeRef],
  )

  // Poll latency while running.
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => {
      if (afeRef.current) {
        setLatencyMs(afeRef.current.latencyMs)
      }
    }, 200)
    return () => clearInterval(id)
  }, [running, afeRef])

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      afeRef.current?.stop()
      onRunningChange(false)
    }
  }, [afeRef, onRunningChange])

  const latencyColor =
    latencyMs > 150
      ? 'text-danger'
      : latencyMs > 100
        ? 'text-warning'
        : 'text-success'

  return (
    <section className="mx-auto max-w-5xl px-6 py-12">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-ink-1">Live AFE pipeline</h2>
        <p className="text-sm text-ink-2">
          Phase 1 · AEC (passthrough) -&gt; BSS (passthrough) -&gt; NS (RNNoise
          WASM). AEC3 and BSS are deferred (ADR-016); VAD from RNNoise for v1.
        </p>
      </div>

      {/* Controls */}
      <div className="mb-6 flex flex-nowrap items-center gap-4 overflow-x-auto rounded-xl border border-line bg-surface-2 p-5">
        {!running ? (
          <button
            onClick={handleStart}
            className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-ink-1 transition hover:bg-brand-400"
          >
            Start microphone
          </button>
        ) : (
          <button
            onClick={handleStop}
            className="rounded-lg bg-danger/90 px-4 py-2 text-sm font-medium text-ink-1 transition hover:bg-red-500"
          >
            Stop
          </button>
        )}

        {running && (
          <div className="flex items-center gap-2 text-sm whitespace-nowrap">
            <span className="text-ink-2">Latency:</span>
            <span className={`inline-block w-14 text-right font-mono font-semibold ${latencyColor}`}>
              {latencyMs.toFixed(0)} ms
            </span>
            <span className="text-ink-3">/ 150 ms budget</span>
          </div>
        )}

        {error && (
          <span className="text-sm text-danger">{error}</span>
        )}
      </div>

      {/* Pipeline overview (flow + scrolling curve) */}
      {running && (
        <div className="mb-6">
          <PipelineOverview
            frameData={frameData}
            running={running}
            latencyMs={latencyMs}
          />
        </div>
      )}

      {/* Per-stage panels */}
      {running && (
        <div className="grid gap-4 sm:grid-cols-3 items-start">
          {(['aec', 'bss', 'ns'] as const).map((id) => (
            <StagePanel
              key={id}
              id={id}
              data={frameData[id]}
              isBypassed={bypass[id]}
              onToggleBypass={toggleBypass}
            />
          ))}
        </div>
      )}

      {/* Record & replay */}
      {running && (
        <div className="mt-4">
          <RecordReplay pipeline={afeRef.current} running={running} />
        </div>
      )}

      {/* Config panel (ADR-017) - unified spec-driven rendering. */}
      <div className="mt-6 rounded-xl border border-line bg-surface-2 p-5">
        <h3 className="mb-4 text-sm font-semibold text-ink-1">
          Configuration{' '}
          <span className="text-xs font-normal text-ink-3">(ADR-017)</span>
        </h3>
        <UnifiedConfigPanel
          title="Pipeline parameters"
          subtitle="Rendered from describeParameters() via module-kit controls."
          params={params}
          values={{
            vizFps,
            'bypass.aec': bypass.aec,
            'bypass.bss': bypass.bss,
            'bypass.ns': bypass.ns,
          }}
          onParamChange={(id, v) => {
            if (id === 'vizFps') {
              const n = Number(v)
              setVizFps(n)
              afeRef.current?.setConfig({ vizFps: n })
              persist({ vizFps: n })
            } else if (id.startsWith('bypass.')) {
              const stageId = id.slice('bypass.'.length) as 'aec' | 'bss' | 'ns'
              toggleBypass(stageId)
            }
          }}
          advancedIds={['bypass.aec', 'bypass.bss', 'bypass.ns', 'latencyBudgetMs']}
          disabled={running}
        />
        <p className="mt-3 text-xs text-ink-3">
          {params.length} parameters exposed via{' '}
          <code className="text-ink-2">describeParameters()</code> · config
          panel is built incrementally per phase.
        </p>
      </div>
    </section>
  )
}

/** Memoized per-stage card. Only re-renders when this stage's data or bypass
 *  changes, not when other stages update (avoids 30fps re-renders of all 3). */
const StagePanel = memo(function StagePanel({
  id,
  data,
  isBypassed,
  onToggleBypass,
}: {
  id: 'aec' | 'bss' | 'ns'
  data?: StageFrameData
  isBypassed: boolean
  onToggleBypass: (id: 'aec' | 'bss' | 'ns') => void
}) {
  return (
    <div className="rounded-xl border border-line bg-surface-2 p-5">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-semibold uppercase text-brand-300">
          {id}
        </span>
        <button
          onClick={() => onToggleBypass(id)}
          className={`rounded px-2 py-0.5 text-[10px] font-medium uppercase ${
            isBypassed
              ? 'bg-surface-4 text-ink-2'
              : 'bg-emerald-500/20 text-emerald-300'
          }`}
        >
          {isBypassed ? 'Bypassed' : 'Active'}
        </button>
      </div>

      {/* Waveform */}
      <div className="mb-3">
        <WaveformCanvas data={data?.waveform} />
      </div>

      {/* Level - always rendered for stable card height */}
      <div className="flex items-center gap-2 text-xs whitespace-nowrap">
        <span className="w-12 shrink-0 text-ink-3">Level</span>
        <div className="flex-1">
          <LevelBar db={data?.levelDb ?? -60} />
        </div>
        <span className="w-20 shrink-0 text-right font-mono text-ink-2">
          {data?.levelDb != null ? `${data.levelDb.toFixed(1)} dB` : '-'}
        </span>
      </div>

      {/* VAD (NS only for v1) - always rendered for stable card height */}
      {id === 'ns' && (
        <div className="mt-2 flex items-center gap-2 text-xs whitespace-nowrap">
          <span className="w-12 shrink-0 text-ink-3">VAD</span>
          <div className="flex-1">
            <div className="h-2 overflow-hidden rounded-full bg-surface-4">
              <div
                className="h-full rounded-full bg-sky-400"
                style={{
                  width: `${(data?.vadProbability ?? 0) * 100}%`,
                }}
              />
            </div>
          </div>
          <span className="w-20 shrink-0 text-right font-mono text-ink-2">
            {data?.vadProbability != null
              ? `${(data.vadProbability * 100).toFixed(0)}%`
              : '-'}
          </span>
        </div>
      )}

      {/* Spectrum (NS only) - always rendered for stable card height */}
      {id === 'ns' && (
        <div className="mt-2">
          <div className="mb-1 text-xs text-ink-3">Spectrum</div>
          <SpectrogramCanvas data={data?.spectrum ?? new Float32Array(64)} />
        </div>
      )}
    </div>
  )
})

/** Mini Canvas waveform display. */
function WaveformCanvas({ data }: { data?: Float32Array }) {
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
function LevelBar({ db }: { db: number }) {
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

/** Mini spectrum display for the NS stage (frequency analyzer bars). */
function SpectrogramCanvas({ data }: { data: Float32Array }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const w = canvas.width
    const h = canvas.height
    ctx.clearRect(0, 0, w, h)

    const barWidth = w / data.length
    for (let i = 0; i < data.length; i++) {
      // Logarithmic scale: emphasize lower frequencies.
      const mag = Math.min(1, data[i] * 4)
      const barH = mag * h
      const hue = 200 - mag * 120 // blue -> green -> red
      ctx.fillStyle = `hsl(${hue}, 70%, ${30 + mag * 40}%)`
      ctx.fillRect(i * barWidth, h - barH, barWidth - 1, barH)
    }
  }, [data])

  return (
    <canvas
      ref={canvasRef}
      width={256}
      height={48}
      className="h-12 w-full rounded bg-surface-3"
    />
  )
}
