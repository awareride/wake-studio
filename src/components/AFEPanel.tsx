import { useCallback, useEffect, useRef, useState } from 'react'
import { AFEPipeline } from '../afe'
import type { StageFrameData } from '../afe'
import { describeParameters } from '../afe'
import { PipelineOverview } from './PipelineOverview'
import { RecordReplay } from './RecordReplay'

export function AFEPanel() {
  const pipelineRef = useRef<AFEPipeline | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [latencyMs, setLatencyMs] = useState(0)
  const [frameData, setFrameData] = useState<Record<string, StageFrameData>>({})
  const [vizFps, setVizFps] = useState(30)
  const [bypass, setBypass] = useState({ aec: true, bss: true, ns: false })

  const params = describeParameters()

  const handleStart = useCallback(async () => {
    setError(null)
    if (!pipelineRef.current) {
      pipelineRef.current = new AFEPipeline()
    }
    const p = pipelineRef.current
    p.onFrame((f) => {
      setFrameData((prev) => ({ ...prev, [f.stageId]: f }))
    })
    try {
      await p.start()
      setRunning(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  const handleStop = useCallback(() => {
    pipelineRef.current?.stop()
    setRunning(false)
    setFrameData({})
    setLatencyMs(0)
  }, [])

  const toggleBypass = useCallback(
    (stageId: 'aec' | 'bss' | 'ns') => {
      const newVal = !bypass[stageId]
      setBypass((prev) => ({ ...prev, [stageId]: newVal }))
      pipelineRef.current?.setBypassed(stageId, newVal)
    },
    [bypass],
  )

  // Poll latency while running.
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => {
      if (pipelineRef.current) {
        setLatencyMs(pipelineRef.current.latencyMs)
      }
    }, 200)
    return () => clearInterval(id)
  }, [running])

  // Cleanup on unmount.
  useEffect(() => {
    return () => pipelineRef.current?.stop()
  }, [])

  const latencyColor =
    latencyMs > 150
      ? 'text-red-400'
      : latencyMs > 100
        ? 'text-amber-400'
        : 'text-emerald-400'

  return (
    <section className="mx-auto max-w-5xl px-6 py-12">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-white">Live AFE pipeline</h2>
        <p className="text-sm text-slate-400">
          Phase 1 · AEC (passthrough) -&gt; BSS (passthrough) -&gt; NS (RNNoise
          WASM). AEC3 and BSS are deferred (ADR-016); VAD from RNNoise for v1.
        </p>
      </div>

      {/* Controls */}
      <div className="mb-6 flex flex-wrap items-center gap-4 rounded-xl border border-white/10 bg-white/[0.03] p-5">
        {!running ? (
          <button
            onClick={handleStart}
            className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-400"
          >
            Start microphone
          </button>
        ) : (
          <button
            onClick={handleStop}
            className="rounded-lg bg-red-500/80 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-500"
          >
            Stop
          </button>
        )}

        {running && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-slate-400">Latency:</span>
            <span className={`font-mono font-semibold ${latencyColor}`}>
              {latencyMs.toFixed(0)} ms
            </span>
            <span className="text-slate-500">/ 150 ms budget</span>
          </div>
        )}

        {error && (
          <span className="text-sm text-red-400">{error}</span>
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
        <div className="grid gap-4 sm:grid-cols-3">
          {(['aec', 'bss', 'ns'] as const).map((id) => {
            const data = frameData[id]
            const isBypassed = bypass[id]
            return (
              <div
                key={id}
                className="rounded-xl border border-white/10 bg-white/[0.03] p-5"
              >
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-sm font-semibold uppercase text-brand-300">
                    {id}
                  </span>
                  <button
                    onClick={() => toggleBypass(id)}
                    className={`rounded px-2 py-0.5 text-[10px] font-medium uppercase ${
                      isBypassed
                        ? 'bg-slate-700 text-slate-400'
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

                {/* Level */}
                {data?.levelDb != null && (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="w-12 text-slate-500">Level</span>
                    <div className="flex-1">
                      <LevelBar db={data.levelDb} />
                    </div>
                    <span className="w-14 text-right font-mono text-slate-400">
                      {data.levelDb.toFixed(1)} dB
                    </span>
                  </div>
                )}

                {/* VAD (NS only for v1) */}
                {id === 'ns' && data?.vadProbability != null && (
                  <div className="mt-2 flex items-center gap-2 text-xs">
                    <span className="w-12 text-slate-500">VAD</span>
                    <div className="flex-1">
                      <div className="h-2 overflow-hidden rounded-full bg-slate-700">
                        <div
                          className="h-full rounded-full bg-sky-400 transition-all"
                          style={{
                            width: `${data.vadProbability * 100}%`,
                          }}
                        />
                      </div>
                    </div>
                    <span className="w-14 text-right font-mono text-slate-400">
                      {(data.vadProbability * 100).toFixed(0)}%
                    </span>
                  </div>
                )}

                {/* Spectrum (NS only) */}
                {id === 'ns' && data?.spectrum && (
                  <div className="mt-2">
                    <div className="mb-1 text-xs text-slate-500">Spectrum</div>
                    <SpectrogramCanvas data={data.spectrum} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Record & replay */}
      {running && (
        <div className="mt-4">
          <RecordReplay pipeline={pipelineRef.current} running={running} />
        </div>
      )}

      {/* Config panel (ADR-017) */}
      <div className="mt-6 rounded-xl border border-white/10 bg-white/[0.03] p-5">
        <h3 className="mb-4 text-sm font-semibold text-white">
          Configuration{' '}
          <span className="text-xs font-normal text-slate-500">(ADR-017)</span>
        </h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex items-center gap-3 text-sm">
            <span className="w-32 text-slate-400">Visualization FPS</span>
            <input
              type="range"
              min={15}
              max={60}
              step={5}
              value={vizFps}
              onChange={(e) => {
                const v = Number(e.target.value)
                setVizFps(v)
                pipelineRef.current?.setConfig({ vizFps: v })
              }}
              className="flex-1 accent-brand-400"
            />
            <span className="w-10 text-right font-mono text-slate-300">
              {vizFps}
            </span>
          </label>
          <div className="flex items-center gap-3 text-sm text-slate-500">
            <span className="w-32">Topology</span>
            <span className="rounded bg-slate-700/50 px-2 py-1 text-xs text-slate-300">
              single-worklet (v1)
            </span>
          </div>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          {params.length} parameters exposed via{' '}
          <code className="text-slate-400">describeParameters()</code> · config
          panel is built incrementally per phase.
        </p>
      </div>
    </section>
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
      className="w-full rounded bg-slate-950/60"
    />
  )
}

/** Level meter (dBFS, -60 to 0). */
function LevelBar({ db }: { db: number }) {
  const pct = Math.max(0, Math.min(100, ((db + 60) / 60) * 100))
  const color =
    db > -6 ? 'bg-red-400' : db > -20 ? 'bg-amber-400' : 'bg-emerald-400'
  return (
    <div className="h-2 overflow-hidden rounded-full bg-slate-700">
      <div
        className={`h-full rounded-full ${color} transition-all`}
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
      className="w-full rounded bg-slate-950/60"
    />
  )
}
