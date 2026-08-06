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
          the three cards stay information-aligned. */}
      <div className="mt-2">
        <div className="mb-1 text-xs text-ink-3">Spectrum</div>
        <Spectrogram data={data?.spectrum ?? new Float32Array(64)} />
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

/**
 * Rolling spectrogram (time on X, frequency on Y, energy as color) for every
 * AFE stage. RNNoise-style: shows how the energy distribution evolves over
 * time so the operator can spot speech formants (bright bands) versus
 * stationary noise (flat low band) and silence (dark uniform).
 *
 * The worklet emits one magnitude spectrum per frame (SPECTRUM_BINS=64 bins,
 * linear). We convert each bin to dBFS, normalize against a -60 dB floor,
 * and color it with a viridis-like ramp (dark blue -> cyan -> green -> yellow
 * -> red). A ring buffer (~4 s @ 30 fps) holds the last 128 frames; we
 * redraw the whole canvas on every new frame.
 *
 * The 2D context API is slow when drawing many small rects; instead we keep
 * a per-pixel ring buffer and scroll the canvas one column per frame
 * (drawImage left-shift + draw the new rightmost column). This mirrors the
 * Spectro project's approach (circular queue of FFT rows + GPU texture
 * offset) but stays on 2D canvas so each of the three stage cards can own its
 * own cheap renderer.
 */

function Spectrogram({ data }: { data: Float32Array }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  type SpecState = { bins: number; width: number; data: Float32Array; head: number; filled: number }
  const stateRef = useRef<SpecState>({ bins: 0, width: 0, data: new Float32Array(0), head: 0, filled: 0 })
  // StrictMode double-invokes effects in dev with the SAME data reference;
  // enqueueing the same frame twice corrupts the ring (head advances 2 but
  // the canvas scrolls 1). Skip identical references.
  const lastDataRef = useRef<Float32Array | null>(null)

  useEffect(() => {
    if (!data || data.length === 0) return
    if (lastDataRef.current === data) return // same frame again (StrictMode)
    lastDataRef.current = data
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const bins = data.length
    const w = canvas.width
    const h = canvas.height
    let s = stateRef.current
    if (s.bins !== bins || s.width !== w) {
      s = { bins, width: w, data: new Float32Array(w * bins), head: 0, filled: 0 }
      stateRef.current = s
      // First frame with a new size: clear the canvas.
      ctx.clearRect(0, 0, w, h)
    }

    // --- 1. Convert this frame's linear magnitudes to normalized intensity ---
    // computeSpectrum emits magnitude normalized by sqrt(FFT_SIZE): room noise
    // sits around -43 dBFS and speech around -23 dBFS (per-bin, after the
    // window). We normalize against a -55 dB floor so broadband room noise is
    // visibly lit (teal) instead of falling into the darkest color, while
    // speech still reads bright. A gentle log contrast keeps the ramp smooth.
    const FLOOR_DB = -55
    const col = new Float32Array(bins)
    for (let i = 0; i < bins; i++) {
      const db = 20 * Math.log10(Math.max(data[i], 1e-9))
      let norm = (db - FLOOR_DB) / -FLOOR_DB // [0..1], floor at 0
      norm = Math.min(1, Math.max(0, norm))
      // Log contrast (same idea as the shader's log(1+i*c)/log(1+c)).
      col[i] = Math.log(1 + norm * 5) / Math.log(1 + 5)
    }

    // --- 2. Enqueue into the ring buffer (newest at head) ---
    const rowOff = s.head * bins
    s.data.set(col, rowOff)
    s.head = (s.head + 1) % w
    if (s.filled < w) s.filled++

    // --- 3. Render: scroll left by one column, draw the newest column on the
    //        right. Canvas pixels map 1:1 to ring columns (width = canvas w).
    ctx.drawImage(canvas, 1, 0, w - 1, h, 0, 0, w - 1, h)

    // The rightmost column now shows the previous newest; redraw it from the
    // newest ring column (head-1 mod w). Use per-pixel fill via putImageData
    // on a 1px-wide column.
    const newest = (s.head - 1 + w) % w
    const img = ctx.createImageData(1, h)
    // Map canvas rows to FFT bins via a mel-like (log-ish) scale.
    //
    // Frequency-axis facts:
    //  - The worklet's spectrum is computed from 48 kHz samples, so bin k
    //    covers [k, k+1) * 24000/64 Hz (Nyquist 24 kHz, bin width 375 Hz).
    //  - The KWS stage runs at 16 kHz (downsample48to16), so frequencies
    //    above 8 kHz carry no information for wake-word detection and would
    //    just waste canvas height on mostly-empty high bins.
    // We therefore display 0-8 kHz across the full canvas height, using mel
    // spacing so the low-frequency band (where room noise and speech formants
    // live) gets the visual resolution it deserves.
    const FMAX_HZ = 8000 // display top (matches 16 kHz KWS output Nyquist)
    const NYQUIST_HZ = 24000 // spectrum was computed at 48 kHz
    const MEL_MAX = melOf(FMAX_HZ)
    for (let y = 0; y < h; y++) {
      // Row y (0 at top) -> frequency from high (top) to low (bottom) on mel.
      const t = (h - 1 - y) / (h - 1) // 1 at bottom (0 Hz) -> 0 at top (8 kHz)
      const freqHz = melInv(MEL_MAX * (1 - t)) // 0 Hz at bottom, 8 kHz at top
      // Map Hz -> actual FFT bin at 48 kHz sample rate.
      const bin = Math.min(
        bins - 1,
        Math.floor((freqHz / NYQUIST_HZ) * bins),
      )
      const [r, g, b] = spectrogramColor(s.data[newest * bins + bin])
      const p = y * 4
      img.data[p] = r
      img.data[p + 1] = g
      img.data[p + 2] = b
      img.data[p + 3] = 255
    }
    ctx.putImageData(img, w - 1, 0)

    // Fill the columns that are still empty (before 'filled' reaches width)
    // with the background color so there is no garbage on the left edge.
    // New data enters at the right edge (we draw column w-1 each frame), so
    // before the ring wraps the empty region is the leftmost (w - filled) px.
    if (s.filled < w) {
      const bg = spectrogramColor(0)
      ctx.fillStyle = `rgb(${bg[0]},${bg[1]},${bg[2]})`
      ctx.fillRect(0, 0, w - s.filled, h)
    }
  }, [data])

  // Clear on unmount so a remounted component (e.g. HMR) starts clean.
  useEffect(() => {
    return () => {
      stateRef.current = { bins: 0, width: 0, data: new Float32Array(0), head: 0, filled: 0 }
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      width={256}
      height={64}
      className="h-16 w-full rounded bg-surface-3"
    />
  )
}

/**
 * Mel-scale helpers (same formulas as the reference spectro project):
 * hzToMel / melToHz. Used to spread the low-frequency band (where ambient
 * noise energy concentrates) across more canvas rows.
 */
function melOf(hz: number): number {
  return 2595 * Math.log10(1 + hz / 700)
}

function melInv(mel: number): number {
  return 700 * (10 ** (mel / 2595) - 1)
}

/**
 * Viridis-like color ramp for the spectrogram: dark navy -> teal -> green ->
 * yellow -> orange -> red. Matches the perceptual RNNoise demo look (warm
 * highs, cool lows).
 */
function spectrogramColor(t: number): [number, number, number] {  // 5-stop ramp.
  const stops: Array<[number, [number, number, number]]> = [
    [0.0, [16, 18, 60]],
    [0.25, [24, 117, 156]],
    [0.5, [42, 173, 140]],
    [0.75, [220, 197, 75]],
    [1.0, [220, 80, 50]],
  ]
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, c0] = stops[i]
    const [t1, c1] = stops[i + 1]
    if (t <= t1) {
      const f = (t - t0) / (t1 - t0)
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * f),
        Math.round(c0[1] + (c1[1] - c0[1]) * f),
        Math.round(c0[2] + (c1[2] - c0[2]) * f),
      ]
    }
  }
  return stops[stops.length - 1][1]
}
