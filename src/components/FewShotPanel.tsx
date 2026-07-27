import { memo, useCallback, useRef, useState, useEffect } from 'react'
import type { AFEPipeline } from '../afe'
import { KWSEngine, DEFAULT_CONFIG as KWS_DEFAULTS } from '../kws'
import type { KWSScoreSample, KWSStatus } from '../kws'
import { FewShotEngine, DEFAULT_CONFIG as FS_DEFAULTS } from '../few-shot'
import type { EnrolledSample, FewShotConfig, WakeWordPrototype } from '../few-shot'

// WavLM encoder URL (MIT, ~95 MB int8). Loaded on demand for enrollment.
const WAVLM_URL = 'https://huggingface.co/microsoft/wavlm-base-plus/resolve/main/model.onnx'

const RECORD_MS = 1500
const MIN_SAMPLES = 3
const HISTORY_MAX = 300

interface Props {
  afePipeline: AFEPipeline | null
  afeRunning: boolean
}

export const FewShotPanel = memo(function FewShotPanel({
  afePipeline,
  afeRunning,
}: Props) {
  const engineRef = useRef<KWSEngine | null>(null)
  const fsEngineRef = useRef<FewShotEngine | null>(null)
  const [status, setStatus] = useState<KWSStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [samples, setSamples] = useState<EnrolledSample[]>([])
  const [recording, setRecording] = useState(false)
  const [detecting, setDetecting] = useState(false)
  const [triggerFlash, setTriggerFlash] = useState(false)
  const [config] = useState<FewShotConfig>({ ...FS_DEFAULTS })
  const historyRef = useRef<KWSScoreSample[]>([])
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const recordCtxRef = useRef<AudioContext | null>(null)

  // Initialize engines lazily.
  const ensureEngines = useCallback(() => {
    if (!engineRef.current) {
      engineRef.current = new KWSEngine()
      engineRef.current.onScore((s) => {
        historyRef.current.push(s)
        if (historyRef.current.length > HISTORY_MAX) historyRef.current.shift()
      })
      engineRef.current.onTrigger(() => {
        setTriggerFlash(true)
        setTimeout(() => setTriggerFlash(false), 500)
      })
    }
    if (!fsEngineRef.current) {
      fsEngineRef.current = new FewShotEngine(engineRef.current)
    }
    return engineRef.current
  }, [])

  const handleLoadEncoder = useCallback(async () => {
    setError(null)
    const engine = ensureEngines()
    try {
      setStatus('loading')
      // Load with wavlm only (for embedding). The backend id doesn't matter
      // for enrollment - we just need the WavLM encoder for embed().
      engine.setConfig({ ...KWS_DEFAULTS, backend: 'openwakeword' })
      await engine.load({ wavlm: WAVLM_URL })
      setStatus(engine.status)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStatus('error')
    }
  }, [ensureEngines])

  /** Record a 1.5 s sample from the mic at 16 kHz. */
  const handleRecord = useCallback(async () => {
    setError(null)
    setRecording(true)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      })
      const ctx = new AudioContext({ sampleRate: 16000 })
      recordCtxRef.current = ctx
      const source = ctx.createMediaStreamSource(stream)
      const processor = ctx.createScriptProcessor(4096, 1, 1)
      const chunks: Float32Array[] = []
      processor.onaudioprocess = (e) => {
        chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)))
      }
      source.connect(processor)
      processor.connect(ctx.destination)

      await new Promise((r) => setTimeout(r, RECORD_MS))
      processor.disconnect()
      source.disconnect()
      stream.getTracks().forEach((t) => t.stop())

      // Concatenate chunks.
      const total = chunks.reduce((a, c) => a + c.length, 0)
      const audio = new Float32Array(total)
      let off = 0
      for (const c of chunks) {
        audio.set(c, off)
        off += c.length
      }

      // Embed the sample.
      ensureEngines()
      const sample = await fsEngineRef.current!.embedSample(audio, 16000)
      setSamples((prev) => [...prev, sample])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRecording(false)
      recordCtxRef.current?.close().catch(() => {})
      recordCtxRef.current = null
    }
  }, [ensureEngines])

  const handleBuildPrototype = useCallback(async () => {
    setError(null)
    const fs = fsEngineRef.current!
    const proto = fs.buildPrototype('custom-word', samples)
    await fs.savePrototype(proto, samples)
    // Store for detection.
    protoRef.current = proto
  }, [samples])

  const protoRef = useRef<WakeWordPrototype | null>(null)

  const handleStartDetection = useCallback(async () => {
    setError(null)
    const engine = engineRef.current!
    const proto = protoRef.current
    if (!proto) {
      setError('Build a prototype first.')
      return
    }
    if (!afePipeline || !afeRunning) {
      setError('Start the AFE microphone first.')
      return
    }
    try {
      // Reload the engine with the wavlm-few-shot backend + prototype.
      // We need a fresh worker: dispose and recreate.
      engine.dispose()
      const fresh = new KWSEngine()
      fresh.onScore((s) => {
        historyRef.current.push(s)
        if (historyRef.current.length > HISTORY_MAX) historyRef.current.shift()
      })
      fresh.onTrigger(() => {
        setTriggerFlash(true)
        setTimeout(() => setTriggerFlash(false), 500)
      })
      engineRef.current = fresh
      fresh.setConfig({ ...KWS_DEFAULTS, backend: 'wavlm-few-shot' })
      await fresh.load({ wavlm: WAVLM_URL }, proto.vector)
      fresh.start({ onOutput: (cb) => afePipeline.onOutput(cb) })
      setDetecting(true)
      setStatus('running')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStatus('error')
    }
  }, [afePipeline, afeRunning])

  const handleStopDetection = useCallback(() => {
    engineRef.current?.stop()
    setDetecting(false)
    historyRef.current = []
  }, [])

  // Render the score curve.
  useEffect(() => {
    if (!detecting) return
    let rafId: number
    const render = () => {
      const canvas = canvasRef.current
      if (canvas) {
        const ctx = canvas.getContext('2d')
        if (ctx) drawCurve(ctx, canvas, historyRef.current, config.threshold)
      }
      rafId = requestAnimationFrame(render)
    }
    rafId = requestAnimationFrame(render)
    return () => cancelAnimationFrame(rafId)
  }, [detecting, config.threshold])

  useEffect(() => () => engineRef.current?.dispose(), [])

  const encoderReady = status === 'ready' || status === 'running'

  return (
    <section className="mx-auto max-w-5xl px-6 py-12">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-white">Few-Shot enrollment</h2>
        <p className="text-sm text-slate-400">
          Phase 3 · enroll a custom wake word with {MIN_SAMPLES}+ samples (WavLM
          embedding + cosine prototype, ADR-020). 100% client-side
          (enrollment/inference, not training - ADR-013).
        </p>
      </div>

      {/* Controls */}
      <div className="mb-6 flex flex-wrap items-center gap-4 rounded-xl border border-white/10 bg-white/[0.03] p-5">
        {status === 'idle' && (
          <button
            onClick={handleLoadEncoder}
            className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-400"
          >
            Load WavLM encoder (~95 MB)
          </button>
        )}
        {status === 'loading' && (
          <span className="text-sm text-slate-400">Loading WavLM…</span>
        )}
        {encoderReady && !detecting && (
          <button
            onClick={handleRecord}
            disabled={recording}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {recording ? `Recording… (${RECORD_MS}ms)` : 'Record sample'}
          </button>
        )}
        {encoderReady && !detecting && samples.length >= MIN_SAMPLES && (
          <button
            onClick={handleBuildPrototype}
            className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-400"
          >
            Build prototype ({samples.length} samples)
          </button>
        )}
        {encoderReady && protoRef.current && !detecting && afeRunning && (
          <button
            onClick={handleStartDetection}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
          >
            Start Few-Shot detection
          </button>
        )}
        {detecting && (
          <button
            onClick={handleStopDetection}
            className="rounded-lg bg-red-500/80 px-4 py-2 text-sm font-medium text-white hover:bg-red-500"
          >
            Stop detection
          </button>
        )}
        <div
          className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition-all ${
            triggerFlash ? 'scale-125 bg-amber-400 text-slate-900' : 'bg-slate-700 text-slate-500'
          }`}
        >
          {triggerFlash ? '!' : '·'}
        </div>
        {error && <span className="text-sm text-red-400">{error}</span>}
      </div>

      {/* Sample list */}
      {encoderReady && !detecting && samples.length > 0 && (
        <div className="mb-6 rounded-xl border border-white/10 bg-white/[0.03] p-5">
          <h3 className="mb-3 text-sm font-semibold text-white">
            Enrolled samples
          </h3>
          <div className="space-y-2">
            {samples.map((s, i) => (
              <div
                key={s.id}
                className="flex items-center gap-4 text-xs text-slate-400"
              >
                <span className="w-8 font-mono">#{i + 1}</span>
                <span>{s.quality.durationMs.toFixed(0)} ms</span>
                <span>{s.quality.peakDbfs.toFixed(1)} dBFS</span>
                <span>SNR {s.quality.snrDb.toFixed(1)} dB</span>
                <span
                  className={
                    s.quality.acceptable ? 'text-emerald-400' : 'text-amber-400'
                  }
                >
                  {s.quality.clipped ? 'clipped' : s.quality.acceptable ? 'OK' : 'low quality'}
                </span>
              </div>
            ))}
          </div>
          {protoRef.current && (
            <p className="mt-3 text-xs text-emerald-400">
              Prototype built: {protoRef.current.word} ({protoRef.current.vector.length}-dim vector). Ready for detection.
            </p>
          )}
        </div>
      )}

      {/* Score curve */}
      {detecting && (
        <div className="mb-6 rounded-xl border border-white/10 bg-white/[0.03] p-5">
          <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
            <span>Few-Shot score curve (cosine similarity)</span>
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
    </section>
  )
})

function drawCurve(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  history: KWSScoreSample[],
  threshold: number,
): void {
  const w = canvas.width
  const h = canvas.height
  ctx.clearRect(0, 0, w, h)
  ctx.strokeStyle = 'rgba(251,191,36,0.4)'
  ctx.lineWidth = 1
  ctx.setLineDash([4, 4])
  ctx.beginPath()
  ctx.moveTo(0, h - threshold * h)
  ctx.lineTo(w, h - threshold * h)
  ctx.stroke()
  ctx.setLineDash([])
  if (history.length < 2) return
  const xStep = w / (HISTORY_MAX - 1)
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
}
