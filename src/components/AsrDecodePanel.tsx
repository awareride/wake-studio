import { memo, useCallback, useEffect, useRef, useState } from 'react'
import type { AFEPipeline } from '../afe'
import { KWSEngine } from '../kws'
import type { KWSStatus } from '../kws'
import type { AsrDecodeConfig, WakeWordEntry } from '../asr/types'
import { ASR_DEFAULT_CONFIG } from '../asr/AsrDecodeBackend'

const HISTORY_MAX = 300

interface Props {
  afePipeline: AFEPipeline | null
  afeRunning: boolean
}

let _uid = 0
const newId = () => `ww-${Date.now()}-${_uid++}`

export const AsrDecodePanel = memo(function AsrDecodePanel({
  afePipeline,
  afeRunning,
}: Props) {
  const engineRef = useRef<KWSEngine | null>(null)
  const [status, setStatus] = useState<KWSStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [triggerFlash, setTriggerFlash] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)

  const [config, setConfig] = useState<AsrDecodeConfig>({ ...ASR_DEFAULT_CONFIG })
  const [wakeWords, setWakeWords] = useState<WakeWordEntry[]>(
    ASR_DEFAULT_CONFIG.wakeWords.map((w) => ({ ...w })),
  )
  const [transcript, setTranscript] = useState('')

  const historyRef = useRef<number[]>([])
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // ---- config helpers ----

  const patchConfig = useCallback((patch: Partial<AsrDecodeConfig>) => {
    setConfig((prev) => ({ ...prev, ...patch }))
  }, [])

  const patchWakeWords = useCallback(
    (next: WakeWordEntry[]) => {
      setWakeWords(next)
      patchConfig({ wakeWords: next })
    },
    [patchConfig],
  )

  const addWakeWord = useCallback(() => {
    patchWakeWords([...wakeWords, { id: newId(), text: '', enabled: true }])
  }, [wakeWords, patchWakeWords])

  const updateWakeWord = useCallback(
    (id: string, text: string) => {
      patchWakeWords(
        wakeWords.map((w) => (w.id === id ? { ...w, text } : w)),
      )
    },
    [wakeWords, patchWakeWords],
  )

  const toggleWakeWord = useCallback(
    (id: string) => {
      patchWakeWords(
        wakeWords.map((w) =>
          w.id === id ? { ...w, enabled: !w.enabled } : w,
        ),
      )
    },
    [wakeWords, patchWakeWords],
  )

  const removeWakeWord = useCallback(
    (id: string) => {
      patchWakeWords(wakeWords.filter((w) => w.id !== id))
    },
    [wakeWords, patchWakeWords],
  )

  // ---- engine lifecycle ----

  const handleLoad = useCallback(async () => {
    setError(null)
    if (!engineRef.current) engineRef.current = new KWSEngine()
    const engine = engineRef.current
    engine.setConfig({ backend: 'asr-decode', threshold: config.matchThreshold })
    engine.onScore((s) => {
      historyRef.current.push(s.smoothedScore)
      if (historyRef.current.length > HISTORY_MAX) historyRef.current.shift()
    })
    engine.onTrigger(() => {
      setTriggerFlash(true)
      setTimeout(() => setTriggerFlash(false), 500)
    })
    engine.onPartial((text) => setTranscript(text))
    try {
      setStatus('loading')
      await engine.load({}, undefined, {
        ...config,
        wakeWords,
      })
      setStatus(engine.status)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStatus('error')
    }
  }, [config, wakeWords])

  const handleStart = useCallback(() => {
    if (!engineRef.current || !afePipeline || !afeRunning) return
    engineRef.current.start({ onOutput: (cb) => afePipeline.onOutput(cb) })
    setRunning(true)
    setTranscript('')
  }, [afePipeline, afeRunning])

  const handleStop = useCallback(() => {
    engineRef.current?.stop()
    setRunning(false)
    historyRef.current = []
  }, [])

  useEffect(() => () => engineRef.current?.dispose(), [])

  // ---- render score curve ----

  useEffect(() => {
    if (!running) return
    let rafId: number
    const render = () => {
      const canvas = canvasRef.current
      if (canvas) {
        const ctx = canvas.getContext('2d')
        if (ctx) {
          const w = canvas.width
          const h = canvas.height
          ctx.clearRect(0, 0, w, h)
          const ty = h - config.matchThreshold * h
          ctx.strokeStyle = 'rgba(251,191,36,0.4)'
          ctx.setLineDash([4, 4])
          ctx.beginPath()
          ctx.moveTo(0, ty)
          ctx.lineTo(w, ty)
          ctx.stroke()
          ctx.setLineDash([])
          const xStep = w / (HISTORY_MAX - 1)
          ctx.strokeStyle = '#38bdf8'
          ctx.lineWidth = 1.5
          ctx.beginPath()
          for (let i = 0; i < historyRef.current.length; i++) {
            const x = i * xStep
            const y = h - historyRef.current[i] * h
            if (i === 0) ctx.moveTo(x, y)
            else ctx.lineTo(x, y)
          }
          ctx.stroke()
        }
      }
      rafId = requestAnimationFrame(render)
    }
    rafId = requestAnimationFrame(render)
    return () => cancelAnimationFrame(rafId)
  }, [running, config.matchThreshold])

  const canStart = status === 'ready' && afeRunning && !running

  return (
    <section className="mx-auto max-w-5xl px-6 py-12">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-white">
          ASR-Decoding KWS
        </h2>
        <p className="text-sm text-slate-400">
          Inference only (P0, ADR-024). Runs a streaming{' '}
          <span className="text-emerald-300/80">sherpa-onnx</span> ASR engine and
          matches its decoded tokens against an editable wake-word list. No
          training or fine-tuning. Detection runs 100% client-side.
        </p>
      </div>

      {/* Controls */}
      <div className="mb-6 flex flex-wrap items-center gap-4 rounded-xl border border-white/10 bg-white/[0.03] p-5">
        {status === 'idle' && (
          <button
            onClick={handleLoad}
            className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-400"
          >
            Load ASR engine
          </button>
        )}
        {status === 'loading' && (
          <span className="text-sm text-slate-400">Loading sherpa-onnx…</span>
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
        <div
          className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition-all ${
            triggerFlash
              ? 'scale-125 bg-amber-400 text-slate-900'
              : 'bg-slate-700 text-slate-500'
          }`}
        >
          {triggerFlash ? '!' : '·'}
        </div>
        {status === 'ready' && !afeRunning && (
          <span className="text-xs text-amber-300/80">
            Start the AFE microphone first
          </span>
        )}
        {error && <span className="text-sm text-red-400">{error}</span>}
      </div>

      {/* Primary config */}
      {status === 'ready' && (
        <div className="mb-6 space-y-5 rounded-xl border border-white/10 bg-white/[0.03] p-5">
          <h3 className="text-sm font-semibold text-white">
            Configuration{' '}
            <span className="text-xs font-normal text-slate-500">(Primary)</span>
          </h3>

          {/* ASR model + wake-word list */}
          <div>
            <label className="mb-2 block text-sm text-slate-400">
              ASR model (streaming transducer)
            </label>
            <input
              type="text"
              value={config.modelBaseUrl}
              onChange={(e) => patchConfig({ modelBaseUrl: e.target.value })}
              className="w-full rounded bg-slate-800/80 px-2 py-1 text-slate-300"
              title="Base URL of encoder.onnx / decoder.onnx / joiner.onnx / tokens.txt"
            />
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-sm text-slate-400">
                Wake-word list (editable)
              </label>
              <button
                onClick={addWakeWord}
                className="rounded bg-brand-500/20 px-2 py-0.5 text-xs text-brand-300 hover:bg-brand-500/30"
              >
                + Add
              </button>
            </div>
            <div className="space-y-2">
              {wakeWords.map((w) => (
                <div key={w.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={w.enabled}
                    onChange={() => toggleWakeWord(w.id)}
                    className="accent-brand-400"
                    title="Enable/disable this wake word"
                  />
                  <input
                    type="text"
                    value={w.text}
                    placeholder="e.g. hey siri"
                    onChange={(e) => updateWakeWord(w.id, e.target.value)}
                    className="flex-1 rounded bg-slate-800/80 px-2 py-1 text-slate-200"
                  />
                  <button
                    onClick={() => removeWakeWord(w.id)}
                    className="rounded px-2 py-0.5 text-xs text-red-400 hover:bg-red-500/10"
                  >
                    ✕
                  </button>
                </div>
              ))}
              {wakeWords.length === 0 && (
                <p className="text-xs text-slate-500">
                  No wake words. Add at least one to detect.
                </p>
              )}
            </div>
          </div>

          <label className="flex items-center gap-3 whitespace-nowrap text-sm">
            <span className="w-36 shrink-0 text-slate-400">Matching threshold</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={config.matchThreshold}
              onChange={(e) =>
                patchConfig({ matchThreshold: Number(e.target.value) })
              }
              className="flex-1 accent-brand-400"
            />
            <span className="w-10 text-right font-mono text-slate-300">
              {config.matchThreshold.toFixed(2)}
            </span>
          </label>

          <label className="flex items-center gap-3 whitespace-nowrap text-sm">
            <span className="w-36 shrink-0 text-slate-400">Inference mode</span>
            <select
              value={config.inferenceMode}
              onChange={(e) =>
                patchConfig({
                  inferenceMode: e.target.value as AsrDecodeConfig['inferenceMode'],
                })
              }
              className="flex-1 rounded bg-slate-800/80 px-2 py-1 text-slate-200"
            >
              <option value="realtime">Real-time mic</option>
              <option value="offline">Offline file</option>
            </select>
          </label>

          {/* Advanced (collapsible) */}
          <div className="border-t border-white/10 pt-3">
            <button
              onClick={() => setAdvancedOpen((v) => !v)}
              className="text-xs font-medium text-slate-400 hover:text-slate-200"
            >
              {advancedOpen ? '▾' : '▸'} Advanced
            </button>
            {advancedOpen && (
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <label className="flex items-center gap-3 text-sm">
                  <span className="w-36 shrink-0 text-slate-400">Beam size</span>
                  <input
                    type="number"
                    min={1}
                    max={32}
                    value={config.beamSize}
                    onChange={(e) =>
                      patchConfig({ beamSize: Number(e.target.value) })
                    }
                    className="flex-1 rounded bg-slate-800/80 px-2 py-1 text-slate-200"
                  />
                </label>
                <label className="flex items-center gap-3 text-sm">
                  <span className="w-36 shrink-0 text-slate-400">
                    VAD silence (ms)
                  </span>
                  <input
                    type="number"
                    min={100}
                    max={2000}
                    step={100}
                    value={config.vadSilenceMs}
                    onChange={(e) =>
                      patchConfig({ vadSilenceMs: Number(e.target.value) })
                    }
                    className="flex-1 rounded bg-slate-800/80 px-2 py-1 text-slate-200"
                  />
                </label>
                <label className="flex items-center gap-3 text-sm">
                  <span className="w-36 shrink-0 text-slate-400">
                    Repeat suppress (ms)
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={10000}
                    step={500}
                    value={config.repeatSuppressMs}
                    onChange={(e) =>
                      patchConfig({ repeatSuppressMs: Number(e.target.value) })
                    }
                    className="flex-1 rounded bg-slate-800/80 px-2 py-1 text-slate-200"
                  />
                </label>
                <label className="flex items-center gap-3 text-sm">
                  <span className="w-36 shrink-0 text-slate-400">
                    Normalize tokens
                  </span>
                  <input
                    type="checkbox"
                    checked={config.normalizeTokens}
                    onChange={(e) =>
                      patchConfig({ normalizeTokens: e.target.checked })
                    }
                    className="accent-brand-400"
                  />
                  <span className="text-xs text-slate-500">
                    lowercase + strip punctuation
                  </span>
                </label>
                <label className="flex items-center gap-3 text-sm sm:col-span-2">
                  <span className="w-36 shrink-0 text-slate-400">
                    WASM base URL
                  </span>
                  <input
                    type="text"
                    value={config.wasmBaseUrl}
                    onChange={(e) =>
                      patchConfig({ wasmBaseUrl: e.target.value })
                    }
                    className="flex-1 rounded bg-slate-800/80 px-2 py-1 text-slate-300"
                  />
                </label>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Live transcript + score curve */}
      {running && (
        <div className="mb-6 space-y-4 rounded-xl border border-white/10 bg-white/[0.03] p-5">
          <div>
            <div className="mb-1 text-xs text-slate-500">Live transcript</div>
            <div className="min-h-[2rem] rounded bg-slate-950/60 p-2 text-sm text-slate-200">
              {transcript || <span className="text-slate-600">…</span>}
            </div>
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
              <span>Match score (threshold line)</span>
              <span className="font-mono">
                {historyRef.current.length > 0
                  ? historyRef.current[historyRef.current.length - 1].toFixed(3)
                  : ''}
              </span>
            </div>
            <canvas
              ref={canvasRef}
              width={800}
              height={120}
              className="h-[120px] w-full rounded bg-slate-950/60"
            />
          </div>
        </div>
      )}

      {status === 'ready' && (
        <p className="text-xs text-slate-500">
          Requires sherpa-onnx wasm assets in <code>{config.wasmBaseUrl}</code>.
          Download them with <code>node scripts/fetch-sherpa-assets.mjs</code>{' '}
          (Apache-2.0).
        </p>
      )}
    </section>
  )
})
