import { memo, useCallback, useEffect, useRef, useState } from 'react'
import type { AFEPipeline } from '@wake-studio/module-afe-graph'
import {
  KWSEngine,
  DEFAULT_CONFIG,
  describeParameters,
  getBackendRegistry,
} from '@wake-studio/module-kws-engine'
import type {
  BackendModelUrls,
  KWSConfig,
  KWSScoreSample,
  KWSTriggerEvent,
  KWSStatus,
} from '@wake-studio/module-kws-engine'
import { MEL_WINDOW_SIZE } from '@wake-studio/module-kws-engine'
import type { SherpaOnnxKwsConfig } from '@wake-studio/module-kws-engine'
import { UnifiedConfigPanel, type ParamValue } from './UnifiedConfigPanel'
import { useProjectStageConfig } from '../projects'
import { logTrigger, logInfo, logError } from '../log'

// Default keyword list for the sherpa-onnx KWS backend (matches the model
// prebuilt into the wasm .data bundle). For the wenetspeech-3.3M-2024-01-01
// model these use the ppinyin tokenization (per sherpa-onnx text2token).
const KWS_KEYWORDS = [
  'n ǐ h ǎo j ūn g ē :1.5 #0.35 @你好军哥',
  'n ǐ h ǎo w èn w èn :1.5 #0.35 @你好问问',
  'x iǎo ài t óng x ué :1.5 #0.35 @小爱同学',
].join('\n')

// Model URLs (ADR-011). The feature models (melspectrogram, speech-embedding)
// are served from the openwakeword module's own assets dir (ADR-025) -
// byte-identical to the hey-buddy re-hosts and Apache-2.0. The classifier
// stays on the remote hey-buddy model (CC-BY-4.0, commercially clean) - see
// ADR-018 Q-KWS-1.
const MODEL_URLS: BackendModelUrls = {
  melspectrogram: '/modules/kws/openwakeword/assets/openWakeWord/melspectrogram.onnx',
  embedding: '/modules/kws/openwakeword/assets/openWakeWord/embedding_model.onnx',
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
  // Seed config from the active project's KWS snapshot (falls back to defaults).
  const { projectConfig: projCfg, persist } = useProjectStageConfig('kws')
  const [config, setConfig] = useState<KWSConfig>({
    ...DEFAULT_CONFIG,
    ...(projCfg as Partial<KWSConfig> | undefined),
  })
  const [executionProvider, setExecutionProvider] = useState<'webgpu' | 'wasm'>(
    'wasm',
  )
  const [logExport, setLogExport] = useState(false)

  const [lastKeyword, setLastKeyword] = useState('')

  const historyRef = useRef<KWSScoreSample[]>([])
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const params = describeParameters()

  const handleLoad = useCallback(async () => {
    setError(null)
    const engine = engineRef.current
    if (!engine) return
    try {
      setStatus('loading')
      // Ensure the engine has the latest backend selection before loading.
      engine.setConfig({ backend: config.backend, threshold: config.threshold })
      const sherpaKwsConfig: Partial<SherpaOnnxKwsConfig> =
        config.backend === 'sherpa-onnx-kws'
          ? {
              // Q-K2: wasm lives in the sherpa driver module's assets dir
              // (served at /modules/kws/sherpa/assets/... in dev).
              wasmBaseUrl: '/modules/kws/sherpa/assets/sherpa-onnx-kws/',
              keywords: KWS_KEYWORDS,
            }
          : {}
      await engine.load(MODEL_URLS, undefined, sherpaKwsConfig)
      setStatus(engine.status)
      setExecutionProvider(engine.executionProvider)
      logInfo('kws', `Models loaded (backend: ${config.backend})`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStatus('error')
      logError('kws', err instanceof Error ? err.message : String(err))
    }
  }, [config.backend, config.threshold])

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
    // Persist to the active project's KWS snapshot.
    persist(patch)
  }, [persist])

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

  // Create the engine on mount (so backend/config changes made via the panel
  // before the first Load actually reach it), wire subscriptions, and push the
  // current config in. Previously the engine was only instantiated inside
  // handleLoad, which meant an early backend selection was silently ignored
  // and the default (openwakeword) was loaded instead.
  useEffect(() => {
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
      // Publish to the session console (Phase 4) - replaces console.log.
      logTrigger('kws', e)
    })
    engine.onPartial((text: string) => {
      if (text) {
        setLastKeyword(text)
        logInfo('kws', `partial: ${text}`)
      }
    })
    engine.setConfig({ backend: config.backend, threshold: config.threshold })
    // The engine is created once; backend/threshold changes are pushed via
    // updateConfig -> engine.setConfig, so only config.backend/threshold are
    // re-applied here when the user changes them before loading.
    return () => engine.dispose()
  }, [config.backend, config.threshold])

  const canStart = status === 'ready' && afeRunning && !running

  return (
    <section className="mx-auto max-w-5xl px-6 py-12">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-ink-1">KWS detection</h2>
        <p className="text-sm text-ink-2">
          Phase 2 · pluggable KWS backend (ADR-020) running in a Web Worker
          (ADR-018). Active backend:{' '}
          <span className="text-emerald-300/80">OpenWakeWord</span> (hey-buddy,
          mel-spectrogram -&gt; speech-embedding -&gt; classifier). Demo model:{' '}
          <span className="text-emerald-300/80">hey-buddy</span> (CC-BY-4.0,
          commercially clean). VAD gating via AFE RNNoise VAD.
        </p>
      </div>

      {/* Controls */}
      <div className="mb-6 flex flex-wrap items-center gap-4 whitespace-nowrap rounded-xl border border-line bg-surface-2 p-5">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-ink-2">Backend</span>
          <select
            value={config.backend}
            disabled={status === 'loading' || running}
            onChange={(e) =>
              updateConfig({ backend: e.target.value as KWSConfig['backend'] })
            }
            className="truncate rounded bg-surface-3 px-2 py-1 text-ink-2"
          >
            {getBackendRegistry().map((r) => (
              <option key={r.id} value={r.id} disabled={!r.browserFeasible}>
                {r.id}
              </option>
            ))}
          </select>
        </label>
        {status === 'idle' && (
          <button
            onClick={handleLoad}
            className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-ink-1 transition-colors hover:bg-brand-400"
          >
            Load KWS models
          </button>
        )}
        {status === 'loading' && (
          <span className="text-sm text-ink-2">Loading models…</span>
        )}
        {canStart && (
          <button
            onClick={handleStart}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-ink-1 transition-colors hover:bg-emerald-500"
          >
            Start detection
          </button>
        )}
        {running && (
          <button
            onClick={handleStop}
            className="rounded-lg bg-danger/90 px-4 py-2 text-sm font-medium text-ink-1 transition-colors hover:bg-red-500"
          >
            Stop detection
          </button>
        )}

        {status === 'ready' && !afeRunning && (
          <span className="text-xs text-warning">
            Start the AFE microphone first
          </span>
        )}

        {status === 'ready' && (
          <span className="text-xs text-ink-3">
            EP: {executionProvider === 'webgpu' ? 'WebGPU' : 'WASM'}
          </span>
        )}

        {running && warmup && (
          <span className="text-xs text-warning">
            Warming up… (collecting ~2 s of audio context)
          </span>
        )}

        {/* Trigger flash */}
        <div
          className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition-all ${
            triggerFlash
              ? 'scale-125 bg-amber-400 text-ink-1'
              : 'bg-surface-4 text-ink-3'
          }`}
        >
          {triggerFlash ? '!' : '·'}
        </div>

        {error && <span className="text-sm text-danger">{error}</span>}
      </div>

      {/* Score curve */}
      {running && (
        <div className="mb-6 rounded-xl border border-line bg-surface-2 p-5">
          <div className="mb-2 flex items-center justify-between text-xs text-ink-3">
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
            className="h-[160px] w-full rounded bg-surface-3"
          />
        </div>
      )}

      {/* Config panel (ADR-017) - dual-layer: Primary + Advanced (kws-categories §4.1) */}
      {status === 'ready' && (
        <div className="rounded-xl border border-line bg-surface-2 p-5">
          <h3 className="mb-4 text-sm font-semibold text-ink-1">
            Configuration{' '}
            <span className="text-xs font-normal text-ink-3">
              (Traditional KWS · Primary)
            </span>
          </h3>

          {/* Read-only surface flags (not tunable params; reserved). */}
          <div className="mb-4 grid gap-4 sm:grid-cols-2">
            <label className="flex items-center gap-3 whitespace-nowrap text-sm">
              <span className="w-32 shrink-0 text-ink-2">Inference mode</span>
              <select
                value="realtime"
                disabled
                className="flex-1 rounded bg-surface-3 px-2 py-1 text-ink-2"
                title="Real-time mic detection (offline-file import is reserved)."
              >
                <option value="realtime">Real-time mic</option>
                <option value="offline">Offline file</option>
              </select>
            </label>
            <label className="flex items-center gap-3 whitespace-nowrap text-sm">
              <span className="w-32 shrink-0 text-ink-2">Output mode</span>
              <select
                value="trigger"
                disabled
                className="flex-1 rounded bg-surface-3 px-2 py-1 text-ink-2"
                title="Emit a trigger event + score (reserved: score-only / CSV)."
              >
                <option value="trigger">Trigger + score</option>
                <option value="score">Score only</option>
                <option value="csv">CSV log</option>
              </select>
            </label>
            <label className="flex items-center gap-3 whitespace-nowrap text-sm">
              <span className="w-32 shrink-0 text-ink-2">Acceleration</span>
              <select
                value={config.executionProvider}
                disabled
                className="flex-1 rounded bg-surface-3 px-2 py-1 text-ink-2"
                title="WebGPU when available, else WASM (ADR-018)."
              >
                <option value="webgpu">WebGPU</option>
                <option value="wasm">WASM</option>
              </select>
            </label>
            <label className="flex items-center gap-3 whitespace-nowrap text-sm">
              <span className="w-32 shrink-0 text-ink-2">Log export</span>
              <input
                type="checkbox"
                checked={logExport}
                onChange={(e) => setLogExport(e.target.checked)}
                className="accent-brand-400"
              />
              <span className="text-xs text-ink-3">
                Stream scores to console
              </span>
            </label>
          </div>

          {/* Tunable params rendered from the spec descriptors (module-kit). */}
          <UnifiedConfigPanel
            title="Tunable parameters"
            subtitle="Rendered from describeParameters() via module-kit controls."
            params={params}
            values={config as unknown as Record<string, ParamValue>}
            onParamChange={(id, v) => updateConfig({ [id]: v })}
            advancedIds={[
              'minDurationMs',
              'smoothingWindowFrames',
              'cooldownMs',
              'vadThreshold',
            ]}
            disabled={running}
          />
          <p className="mt-3 text-xs text-ink-3">
            {params.length} parameters exposed via{' '}
            <code className="text-ink-2">describeParameters()</code>. Mel
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
