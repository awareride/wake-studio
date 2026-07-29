import { memo, useCallback, useEffect, useRef, useState } from 'react'
import type { AFEPipeline } from '../afe'
import {
  KWSEngine,
  DEFAULT_CONFIG,
  describeParameters,
  BACKEND_REGISTRY,
} from '../kws'
import type {
  BackendModelUrls,
  KWSConfig,
  KWSScoreSample,
  KWSTriggerEvent,
  KWSStatus,
} from '../kws'
import { MEL_WINDOW_SIZE } from '../kws'
import type { SherpaOnnxKwsConfig } from '../kws'

// Default keyword list for the sherpa-onnx KWS backend (matches the model
// prebuilt into the wasm .data bundle). Format: spaced tokens @display name.
const KWS_KEYWORDS =
  'x iǎo ài t óng x ué @小爱同学\n' + 'j ūn g ē n iú b ī @军哥牛逼'

// Model URLs (ADR-011). The feature models (melspectrogram, speech-embedding)
// are served from local prebuilts (ADR-011 amendment) - byte-identical to the
// hey-buddy re-hosts and Apache-2.0. The classifier stays on the remote
// hey-buddy model (CC-BY-4.0, commercially clean) - see ADR-018 Q-KWS-1.
const MODEL_URLS: BackendModelUrls = {
  melspectrogram: '/prebuilts/openWakeWord/melspectrogram.onnx',
  embedding: '/prebuilts/openWakeWord/embedding_model.onnx',
  classifier:
    'https://huggingface.co/benjamin-paine/hey-buddy/resolve/main/models/hey-buddy.onnx',
}

const HISTORY_MAX = 300 // ~3 s at ~100 fps

interface Props {
  afePipeline: AFEPipeline | null
  afeRunning: boolean
}

export const KWSPanel = memo(function KWSPanel({
  afePipeline,
  afeRunning,
}: Props) {
  const engineRef = useRef<KWSEngine | null>(null)
  const [status, setStatus] = useState<KWSStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [triggerFlash, setTriggerFlash] = useState(false)
  const [warmup, setWarmup] = useState(false)
  const [config, setConfig] = useState<KWSConfig>({ ...DEFAULT_CONFIG })
  const [executionProvider, setExecutionProvider] = useState<'webgpu' | 'wasm'>(
    'wasm',
  )
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [logExport, setLogExport] = useState(false)

  const [lastKeyword, setLastKeyword] = useState('')

  const historyRef = useRef<KWSScoreSample[]>([])
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const params = describeParameters()

  const handleLoad = useCallback(async () => {
    setError(null)
    if (!engineRef.current) {
      engineRef.current = new KWSEngine()
    }
    const engine = engineRef.current
    engine.onScore((s) => {
      historyRef.current.push(s)
      if (historyRef.current.length > HISTORY_MAX) {
        historyRef.current.shift()
      }
    })
    engine.onTrigger((e: KWSTriggerEvent) => {
      setTriggerFlash(true)
      setTimeout(() => setTriggerFlash(false), 500)
      console.log('[KWS] Trigger:', e.word, e.peakScore.toFixed(3))
    })
    engine.onPartial((text: string) => {
      if (text) setLastKeyword(text)
    })
    try {
      setStatus('loading')
      const sherpaKwsConfig: Partial<SherpaOnnxKwsConfig> =
        config.backend === 'sherpa-onnx-kws'
          ? { wasmBaseUrl: '/sherpa-onnx-kws/', keywords: KWS_KEYWORDS }
          : {}
      await engine.load(MODEL_URLS, undefined, undefined, sherpaKwsConfig)
      setStatus(engine.status)
      setExecutionProvider(engine.executionProvider)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStatus('error')
    }
  }, [config.backend])

  const handleStart = useCallback(() => {
    if (!engineRef.current || !afePipeline || !afeRunning) return
    engineRef.current.start({
      onOutput: (cb) => afePipeline.onOutput(cb),
    })
    setRunning(true)
    setWarmup(true)
    // Warmup: the backend needs ~76 mel frames + 16 embeddings (~2 s) before
    // producing real scores. Clear the badge after 3 s.
    setTimeout(() => setWarmup(false), 3000)
  }, [afePipeline, afeRunning])

  const handleStop = useCallback(() => {
    engineRef.current?.stop()
    setRunning(false)
    historyRef.current = []
  }, [])

  const updateConfig = useCallback((patch: Partial<KWSConfig>) => {
    setConfig((prev) => {
      const next = { ...prev, ...patch }
      engineRef.current?.setConfig(patch)
      return next
    })
  }, [])

  // Render the score curve via requestAnimationFrame.
  useEffect(() => {
    if (!running) return
    let rafId: number
    const render = () => {
      const canvas = canvasRef.current
      if (canvas) {
        const ctx = canvas.getContext('2d')
        if (ctx) {
          drawScoreCurve(ctx, canvas, historyRef.current, config.threshold)
        }
      }
      rafId = requestAnimationFrame(render)
    }
    rafId = requestAnimationFrame(render)
    return () => cancelAnimationFrame(rafId)
  }, [running, config.threshold])

  // Cleanup on unmount.
  useEffect(() => {
    return () => engineRef.current?.dispose()
  }, [])

  const canStart = status === 'ready' && afeRunning && !running

  return (
    <section className="mx-auto max-w-5xl px-6 py-12">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-white">KWS detection</h2>
        <p className="text-sm text-slate-400">
          Phase 2 · pluggable KWS backend (ADR-020) running in a Web Worker
          (ADR-018). Active backend:{' '}
          <span className="text-emerald-300/80">OpenWakeWord</span> (hey-buddy,
          mel-spectrogram -&gt; speech-embedding -&gt; classifier). Demo model:{' '}
          <span className="text-emerald-300/80">hey-buddy</span> (CC-BY-4.0,
          commercially clean). VAD gating via AFE RNNoise VAD.
        </p>
      </div>

      {/* Controls */}
      <div className="mb-6 flex flex-wrap items-center gap-4 whitespace-nowrap rounded-xl border border-white/10 bg-white/[0.03] p-5">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-slate-400">Backend</span>
          <select
            value={config.backend}
            disabled={status === 'loading' || running}
            onChange={(e) =>
              updateConfig({ backend: e.target.value as KWSConfig['backend'] })
            }
            className="truncate rounded bg-slate-800/80 px-2 py-1 text-slate-300"
          >
            {BACKEND_REGISTRY.map((r) => (
              <option key={r.id} value={r.id} disabled={!r.browserFeasible}>
                {r.id}
              </option>
            ))}
          </select>
        </label>
        {status === 'idle' && (
          <button
            onClick={handleLoad}
            className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-400"
          >
            Load KWS models
          </button>
        )}
        {status === 'loading' && (
          <span className="text-sm text-slate-400">Loading models…</span>
        )}
        {canStart && (
          <button
            onClick={handleStart}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500"
          >
            Start detection
          </button>
        )}
        {running && (
          <button
            onClick={handleStop}
            className="rounded-lg bg-red-500/80 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-500"
          >
            Stop detection
          </button>
        )}

        {status === 'ready' && !afeRunning && (
          <span className="text-xs text-amber-300/80">
            Start the AFE microphone first
          </span>
        )}

        {status === 'ready' && (
          <span className="text-xs text-slate-500">
            EP: {executionProvider === 'webgpu' ? 'WebGPU' : 'WASM'}
          </span>
        )}

        {running && warmup && (
          <span className="text-xs text-amber-300/80">
            Warming up… (collecting ~2 s of audio context)
          </span>
        )}

        {/* Trigger flash */}
        <div
          className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition-all ${
            triggerFlash
              ? 'scale-125 bg-amber-400 text-slate-900'
              : 'bg-slate-700 text-slate-500'
          }`}
        >
          {triggerFlash ? '!' : '·'}
        </div>

        {error && <span className="text-sm text-red-400">{error}</span>}
      </div>

      {/* Score curve */}
      {running && (
        <div className="mb-6 rounded-xl border border-white/10 bg-white/[0.03] p-5">
          <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
            <span>Score curve (raw + smoothed + threshold)</span>
            <span className="font-mono">
              {historyRef.current.length > 0
                ? `score: ${historyRef.current[historyRef.current.length - 1].smoothedScore.toFixed(3)}`
                : ''}
            </span>
          </div>
          <canvas
            ref={canvasRef}
            width={800}
            height={160}
            className="h-[160px] w-full rounded bg-slate-950/60"
          />
        </div>
      )}

      {/* Config panel (ADR-017) - dual-layer: Primary + Advanced (kws-categories §4.1) */}
      {status === 'ready' && (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
          <h3 className="mb-4 text-sm font-semibold text-white">
            Configuration{' '}
            <span className="text-xs font-normal text-slate-500">
              (Traditional KWS · Primary)
            </span>
          </h3>

          {/* Primary: inference mode, threshold, output mode */}
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex items-center gap-3 whitespace-nowrap text-sm">
              <span className="w-32 shrink-0 text-slate-400">Inference mode</span>
              <select
                value={config.executionProvider === 'webgpu' ? 'realtime' : 'realtime'}
                disabled
                className="flex-1 rounded bg-slate-800/80 px-2 py-1 text-slate-300"
                title="Real-time mic detection (offline-file import is reserved)."
              >
                <option value="realtime">Real-time mic</option>
                <option value="offline">Offline file</option>
              </select>
            </label>
            <label className="flex items-center gap-3 whitespace-nowrap text-sm">
              <span className="w-32 shrink-0 text-slate-400">Confidence</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={config.threshold}
                onChange={(e) =>
                  updateConfig({ threshold: Number(e.target.value) })
                }
                className="flex-1 accent-brand-400"
              />
              <span className="w-10 shrink-0 text-right font-mono text-slate-300">
                {config.threshold.toFixed(2)}
              </span>
            </label>
            <label className="flex items-center gap-3 whitespace-nowrap text-sm">
              <span className="w-32 shrink-0 text-slate-400">Output mode</span>
              <select
                value="trigger"
                disabled
                className="flex-1 rounded bg-slate-800/80 px-2 py-1 text-slate-300"
                title="Emit a trigger event + score (reserved: score-only / CSV)."
              >
                <option value="trigger">Trigger + score</option>
                <option value="score">Score only</option>
                <option value="csv">CSV log</option>
              </select>
            </label>
            <label className="flex items-center gap-3 whitespace-nowrap text-sm">
              <span className="w-32 shrink-0 text-slate-400">VAD gate</span>
              <input
                type="checkbox"
                checked={config.vadGateEnabled}
                onChange={(e) =>
                  updateConfig({ vadGateEnabled: e.target.checked })
                }
                className="accent-brand-400"
              />
              <span className="text-xs text-slate-500">
                Suppress triggers in silence
              </span>
            </label>
          </div>

          {/* Advanced (collapsible) */}
          <div className="mt-4 border-t border-white/10 pt-3">
            <button
              onClick={() => setAdvancedOpen((v) => !v)}
              className="text-xs font-medium text-slate-400 hover:text-slate-200"
            >
              {advancedOpen ? '▾' : '▸'} Advanced
            </button>
            {advancedOpen && (
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <label className="flex items-center gap-3 whitespace-nowrap text-sm">
                  <span className="w-32 shrink-0 text-slate-400">Min. duration</span>
                  <input
                    type="range"
                    min={100}
                    max={3000}
                    step={100}
                    value={config.minDurationMs}
                    onChange={(e) =>
                      updateConfig({ minDurationMs: Number(e.target.value) })
                    }
                    className="flex-1 accent-brand-400"
                  />
                  <span className="w-14 shrink-0 text-right font-mono text-slate-300">
                    {config.minDurationMs} ms
                  </span>
                </label>
                <label className="flex items-center gap-3 whitespace-nowrap text-sm">
                  <span className="w-32 shrink-0 text-slate-400">Smoothing</span>
                  <input
                    type="range"
                    min={1}
                    max={30}
                    step={1}
                    value={config.smoothingWindowFrames}
                    onChange={(e) =>
                      updateConfig({
                        smoothingWindowFrames: Number(e.target.value),
                      })
                    }
                    className="flex-1 accent-brand-400"
                  />
                  <span className="w-10 shrink-0 text-right font-mono text-slate-300">
                    {config.smoothingWindowFrames}
                  </span>
                </label>
                <label className="flex items-center gap-3 whitespace-nowrap text-sm">
                  <span className="w-32 shrink-0 text-slate-400">Cooldown</span>
                  <input
                    type="range"
                    min={500}
                    max={10000}
                    step={500}
                    value={config.cooldownMs}
                    onChange={(e) =>
                      updateConfig({ cooldownMs: Number(e.target.value) })
                    }
                    className="flex-1 accent-brand-400"
                  />
                  <span className="w-14 shrink-0 text-right font-mono text-slate-300">
                    {config.cooldownMs} ms
                  </span>
                </label>
                <label className="flex items-center gap-3 whitespace-nowrap text-sm">
                  <span className="w-32 shrink-0 text-slate-400">Mel window</span>
                  <input
                    type="number"
                    value={MEL_WINDOW_SIZE}
                    disabled
                    className="flex-1 rounded bg-slate-800/80 px-2 py-1 text-slate-300"
                  />
                </label>
                <label className="flex items-center gap-3 whitespace-nowrap text-sm">
                  <span className="w-32 shrink-0 text-slate-400">
                    Acceleration
                  </span>
                  <select
                    value={config.executionProvider}
                    disabled
                    className="flex-1 rounded bg-slate-800/80 px-2 py-1 text-slate-300"
                    title="WebGPU when available, else WASM (ADR-018)."
                  >
                    <option value="webgpu">WebGPU</option>
                    <option value="wasm">WASM</option>
                  </select>
                </label>
                <label className="flex items-center gap-3 whitespace-nowrap text-sm">
                  <span className="w-32 shrink-0 text-slate-400">Log export</span>
                  <input
                    type="checkbox"
                    checked={logExport}
                    onChange={(e) => setLogExport(e.target.checked)}
                    className="accent-brand-400"
                  />
                  <span className="text-xs text-slate-500">
                    Stream scores to console
                  </span>
                </label>
              </div>
            )}
          </div>
          <p className="mt-3 text-xs text-slate-500">
            {params.length} parameters exposed via{' '}
            <code className="text-slate-400">describeParameters()</code>. Mel
            window: {MEL_WINDOW_SIZE} samples (80 ms @ 16 kHz).
            {lastKeyword && (
              <>
                {' '}Last keyword:{' '}
                <span className="text-emerald-300/80">{lastKeyword}</span>
              </>
            )}
          </p>
        </div>
      )}
    </section>
  )
})

/** Draw the scrolling score curve with threshold line. */
function drawScoreCurve(
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
