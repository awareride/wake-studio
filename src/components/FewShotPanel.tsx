import { memo, useCallback, useRef, useState, useEffect } from 'react'
import type { AFEPipeline } from '../afe'
import { KWSEngine, DEFAULT_CONFIG as KWS_DEFAULTS } from '../kws'
import type { KWSScoreSample, KWSStatus } from '../kws'
import { FewShotEngine, DEFAULT_CONFIG as FS_DEFAULTS } from '../few-shot'
import type { EnrolledSample, FewShotConfig, WakeWordPrototype } from '../few-shot'
import recorderUrl from '../few-shot/recorder.worklet.ts?worker&url'
import type { ModelRuntime } from '../runtime'
import {
  PLIX_ENCODER_VARIANTS,
  getPlixEncoderVariant,
  type PlixEncoderVariant,
} from '../kws/backends/plix-encoder'
import { RUNTIME_LABELS } from '../runtime'

// PLiX Few-Shot encoder (aaqibsaeed/plixkws, Apache-2.0) - compact CNN
// (EfficientNet-v2 'base' / TinyNet-E 'small') trained as a Prototypical
// Network on 16 kHz one-second clips. Far lighter than WavLM-base-plus, making
// it suitable for end-side / IoT devices. Outputs a 1280-dim embedding for
// prototype-distance matching. Served from local prebuilts in dev (ADR-011
// amendment); remote fallback for deployed builds.
//
// Runtime: 'onnx' (default) loads the exported plixkws-<variant>.onnx via
// onnxruntime-web; 'transformers' loads the encoder browser-native via
// @huggingface/transformers v4 (loaded from the jsDelivr CDN, no .pt / no npm
// install) - it fetches the ONNX weights itself (from a HF repo id or a
// locally-served HF-style directory). Both produce the same embedding. ONNX
// stays the default; switch to 'transformers' for a zero-Python deployment.
// The type is the global ModelRuntime (see src/runtime.ts) so the same
// selector can drive other modules' AFE/KWS models and future runtimes.
//
// The encoder VARIANT ('base' / 'small') is now selectable in the UI (ADR-002):
// the chosen variant selects which exported ONNX graph (or HF repo) the
// embedder loads. Both emit a 1280-dim embedding, so scoring is identical.
const PLIX_VARIANTS: ReadonlyArray<PlixEncoderVariant> = PLIX_ENCODER_VARIANTS
const DEFAULT_VARIANT: PlixEncoderVariant['id'] = 'base'

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
  const [prototype, setPrototype] = useState<WakeWordPrototype | null>(null)
  const [building, setBuilding] = useState(false)
  const [config] = useState<FewShotConfig>({ ...FS_DEFAULTS })
  const [encoderVariant, setEncoderVariant] =
    useState<PlixEncoderVariant['id']>(DEFAULT_VARIANT)
  const [runtime, setRuntime] = useState<ModelRuntime>('onnx')
  const historyRef = useRef<KWSScoreSample[]>([])
  const canvasRef = useRef<HTMLCanvasElement>(null)

  /** Resolve the PLiX model locator for the current variant + runtime. */
  const resolvePlixLocator = useCallback((): { url: string; runtime: ModelRuntime } => {
    const variant = getPlixEncoderVariant(encoderVariant)
    if (!variant) {
      throw new Error(`Unknown PLiX variant: ${encoderVariant}`)
    }
    const rt = runtime
    const url =
      rt === 'transformers'
        ? variant.transformersLocalDir
        : variant.onnxUrl
    return { url, runtime: rt }
  }, [encoderVariant, runtime])

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
      // Load with plixkws only (for embedding). The backend id doesn't matter
      // for enrollment - we just need the PLiX encoder for embed().
      engine.setConfig({ ...KWS_DEFAULTS, backend: 'openwakeword' })
      const { url, runtime: rt } = resolvePlixLocator()
      await engine.load({ plixkws: url, runtime: rt })
      setStatus(engine.status)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // The PLiX weights ship as PyTorch .pt (Dropbox); they must be exported
      // to ONNX and dropped into prebuilts/plixkws/ before the encoder can
      // load. Surface that clearly instead of a raw fetch/404 error.
      const variant = getPlixEncoderVariant(encoderVariant)
      const expected = variant?.onnxUrl ?? '/prebuilts/plixkws/plixkws-base.onnx'
      if (runtime === 'transformers') {
        // The transformers runtime loads the ONNX graph from a locally-exported
        // HF-style dir (config.json + onnx/model.onnx). The Hugging Face repo
        // only ships .pt weights, so it cannot be fetched from the Hub.
        setError(
          `PLiX (${encoderVariant}) 'transformers' runtime needs a locally-exported ` +
            `HF-style dir at ${variant?.transformersLocalDir ?? '/prebuilts/plixkws/hf/plixkws'} ` +
            `(config.json + onnx/model.onnx). Export it with: ` +
            'python scripts/export-plixkws-onnx.py --encoder ' +
            encoderVariant +
            ' --hf-dir prebuilts/plixkws/hf/plixkws. ' +
            'Alternatively, use the default ONNX runtime.',
        )
      } else if (/fetch|404|load failed|not loaded/i.test(msg)) {
        setError(
          `PLiX (${encoderVariant}) encoder model not found. Export the PLiX ` +
            `ONNX (see prebuilts/plixkws/README.md) and place it at ` +
            expected +
            (encoderVariant === 'small'
              ? ' (plus the co-located plixkws-small.onnx.data external weights file).'
              : '.'),
        )
      } else {
        setError(msg)
      }
      setStatus('error')
    }
  }, [ensureEngines, resolvePlixLocator, encoderVariant, runtime])

  /** Record a 1.5 s sample from the mic at 16 kHz. */
  const handleRecord = useCallback(async () => {
    setError(null)
    setRecording(true)
    let ctx: AudioContext | null = null
    let stream: MediaStream | null = null
    let node: AudioWorkletNode | null = null
    let source: MediaStreamAudioSourceNode | null = null
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      })
      ctx = new AudioContext({ sampleRate: 16000 })
      if (ctx.state === 'suspended') await ctx.resume()
      await ctx.audioWorklet.addModule(recorderUrl)

      source = ctx.createMediaStreamSource(stream)
      node = new AudioWorkletNode(ctx, 'few-shot-recorder')
      const chunks: Float32Array[] = []
      node.port.onmessage = (e: MessageEvent<{ type: 'chunk'; samples: Float32Array }>) => {
        if (e.data.type === 'chunk') chunks.push(e.data.samples)
      }
      source.connect(node)
      node.connect(ctx.destination)

      await new Promise((r) => setTimeout(r, RECORD_MS))
      node.disconnect()
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
      try { node?.disconnect() } catch { /* ignore */ }
      try { source?.disconnect() } catch { /* ignore */ }
      stream?.getTracks().forEach((t) => t.stop())
      if (ctx) await ctx.close().catch(() => {})
    }
  }, [ensureEngines])

  const handleBuildPrototype = useCallback(async () => {
    setError(null)
    setBuilding(true)
    try {
      const fs = fsEngineRef.current!
      const proto = fs.buildPrototype('custom-word', samples)
      await fs.savePrototype(proto, samples)
      setPrototype(proto)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBuilding(false)
    }
  }, [samples])

  const handleStartDetection = useCallback(async () => {
    setError(null)
    const engine = engineRef.current!
    const proto = prototype
    if (!proto) {
      setError('Build a prototype first.')
      return
    }
    if (!afePipeline || !afeRunning) {
      setError('Start the AFE microphone first.')
      return
    }
    try {
      // Reload the engine with the plixkws backend + prototype.
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
      fresh.setConfig({ ...KWS_DEFAULTS, backend: 'plixkws' })
      const { url, runtime: rt } = resolvePlixLocator()
      await fresh.load({ plixkws: url, runtime: rt }, proto.vector)
      fresh.start({ onOutput: (cb) => afePipeline.onOutput(cb) })
      setDetecting(true)
      setStatus('running')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStatus('error')
    }
  }, [afePipeline, afeRunning, prototype, resolvePlixLocator])

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
          Phase 3 · enroll a custom wake word with {MIN_SAMPLES}+ samples (PLiX
          embedding + prototype-distance scoring, ADR-020). 100% client-side
          (enrollment/inference, not training - ADR-013).
        </p>
      </div>

      {/* Controls */}
      <div className="mb-6 flex flex-wrap items-center gap-4 rounded-xl border border-white/10 bg-white/[0.03] p-5">
        {status === 'idle' && (
          <>
            <label className="flex items-center gap-2 text-sm text-slate-400">
              <span className="shrink-0">Encoder</span>
              <select
                value={encoderVariant}
                onChange={(e) =>
                  setEncoderVariant(e.target.value as PlixEncoderVariant['id'])
                }
                className="rounded bg-slate-800/80 px-2 py-1 text-slate-200"
                title="Select the PLiX encoder variant (ADR-002). 'base' = EfficientNet-v2-M; 'small' = TinyNet-E (lighter). Both emit a 1280-dim embedding."
              >
                {PLIX_VARIANTS.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-400">
              <span className="shrink-0">Runtime</span>
              <select
                value={runtime}
                onChange={(e) => setRuntime(e.target.value as ModelRuntime)}
                className="rounded bg-slate-800/80 px-2 py-1 text-slate-200"
                title="PLiX execution runtime (ADR-002). 'onnx' (default) loads the exported ONNX graph; 'transformers' runs browser-native via @huggingface/transformers (CDN, no ONNX file)."
              >
                <option value="onnx">ONNX (onnxruntime-web)</option>
                <option value="transformers">{RUNTIME_LABELS.transformers}</option>
              </select>
            </label>
            <button
              onClick={handleLoadEncoder}
              className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-400"
            >
              Load PLiX encoder
            </button>
          </>
        )}
        {status === 'loading' && (
          <span className="text-sm text-slate-400">Loading PLiX…</span>
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
            disabled={building}
            className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-400 disabled:opacity-50"
          >
            {building ? 'Building…' : `Build prototype (${samples.length} samples)`}
          </button>
        )}
        {encoderReady && prototype && !detecting && (
          <>
            <button
              onClick={handleStartDetection}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
            >
              Start Few-Shot detection
            </button>
            {!afeRunning && (
              <span className="text-sm text-amber-400">
                Start the AFE microphone (top panel) first, then click above.
              </span>
            )}
          </>
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
          {prototype && (
            <p className="mt-3 text-xs text-emerald-400">
              Prototype built: {prototype.word} ({prototype.vector.length}-dim vector). Ready for detection.
            </p>
          )}
        </div>
      )}

      {/* Score curve */}
      {detecting && (
        <div className="mb-6 rounded-xl border border-white/10 bg-white/[0.03] p-5">
          <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
            <span>Few-Shot score curve (prototype-distance similarity)</span>
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
