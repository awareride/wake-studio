import { memo, useCallback, useEffect, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import type { AFEPipeline } from '@wake-studio/module-afe-graph'
import { AFEPipeline as AFEPipelineClass } from '@wake-studio/module-afe-graph'
import type { StageFrameData } from '@wake-studio/module-afe-graph'
import { describeParameters } from '@wake-studio/module-afe-graph'
import { UnifiedConfigPanel } from './UnifiedConfigPanel'
import { useProjectStageConfig } from '../projects'
import { logInfo, logError } from '../log'
import { PipelineOverview } from './PipelineOverview'
import { RecordReplay } from './RecordReplay'
import { WebGLSpectrogram } from './spectrogram/WebGLSpectrogram'

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
      logInfo('afe', 'Pipeline started (microphone live)')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      logError('afe', err instanceof Error ? err.message : String(err))
    }
  }, [afeRef, onRunningChange])

  const handleStop = useCallback(() => {
    afeRef.current?.stop()
    setRunning(false)
    onRunningChange(false)
    setFrameData({})
    setLatencyMs(0)
    logInfo('afe', 'Pipeline stopped')
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
    <section className="space-y-8">
      <div>
        <h2 className="text-lg font-semibold text-ink-1">Live AFE pipeline</h2>
        <p className="text-sm text-ink-2">
          Phase 1 · AEC (passthrough) -&gt; BSS (passthrough) -&gt; NS (RNNoise
          WASM). AEC3 and BSS are deferred (ADR-016); VAD from RNNoise for v1.
        </p>
      </div>

      {/* Controls */}
      <div className="flex flex-nowrap items-center gap-4 overflow-x-auto rounded-xl border border-line bg-surface-2 p-5">
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
        <div>
          <PipelineOverview
            frameData={frameData}
            running={running}
            latencyMs={latencyMs}
          />
        </div>
      )}

      {/* Per-stage panels - items-stretch keeps the three cards equal height
          (NS has extra VAD + Spectrum rows, so without stretching it would
          exceed AEC/BSS and break the row alignment). */}
      {running && (
        <div className="grid gap-4 sm:grid-cols-3 items-stretch">
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
    <div className="flex h-full flex-col rounded-xl border border-line bg-surface-2 p-5">
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

      {/* Waveform - flex-1 absorbs the height difference between stages so
          the three cards (AEC/BSS/NS) stay equal height. With scheme 1 (info
          completion) each stage also carries a metric row below, so the extra
          space is filled with information, not whitespace. */}
      <div className="mb-3 flex-1">
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

      {/* Stage-specific metric row - one per stage so all three cards share
          the same information depth (scheme 1). AEC/BSS report placeholder
          values from the worklet's metrics (passthrough); the real algorithm
          fills them later without touching this UI. */}
      {id === 'aec' && (
        <StageMetricRow
          label="Echo red."
          value={data?.metrics?.erleDb}
          unit="dB"
          placeholder={isBypassed ? 'passthrough' : '—'}
        />
      )}
      {id === 'bss' && (
        <StageMetricRow
          label="Separ."
          value={data?.metrics?.siSdrDb}
          unit="dB"
          placeholder={isBypassed ? 'passthrough' : '—'}
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

      {/* Spectrum - all three stages show their own magnitude spectrum (AEC =
          raw input, BSS = passthrough, NS = denoised). Same card structure so
          the three cards stay information-aligned. Rendered with the WebGL
          Spectro-style renderer (ADR-032). */}
      <div className="mt-2">
        <div className="mb-1 text-xs text-ink-3">Spectrum</div>
        <WebGLSpectrogram data={data?.spectrogram} />
      </div>
    </div>
  )
})

/** One stage-specific metric row (AEC ERLE / BSS separation / NS VAD). */
function StageMetricRow({
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
