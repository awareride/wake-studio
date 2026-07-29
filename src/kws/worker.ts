/**
 * KWS Web Worker - backend-agnostic inference loop (ADR-018, ADR-020).
 *
 * Runs off-main-thread to avoid blocking the UI. The worker owns the generic
 * loop (VAD gate, score smoothing, trigger) and delegates model-specific
 * inference to a pluggable {@link KWSBackend} (ADR-020). It also hosts an
 * optional {@link PlixKwsEmbedProvider} for the Few-Shot `embed()` scaffold
 * (Phase 3), independent of the detection backend.
 *
 * Pure logic (ScoreSmoother, TriggerDetector, VAD gate) is in ./dsp.
 */

import type {
  BackendModelUrls,
  KWSBackend,
  KWSBackendId,
  KWSConfig,
  KWSMainMessage,
  KWSWorkerMessage,
} from './types'
import { DEFAULT_MODEL_RUNTIME } from '../runtime'
import { createBackend } from './backend'
import { AsrDecodeBackend } from '../asr/AsrDecodeBackend'
import type { AsrDecodeConfig } from '../asr/types'
import type { SherpaOnnxKwsConfig } from './types'
import { PlixKwsEmbedProvider } from './backends/plixkws-embed'
import { PlixKwsBackend } from './backends/plixkws'
import { SherpaOnnxKwsBackend } from './backends/sherpa-onnx-kws'
import { DEFAULT_CONFIG } from './defaults'
import { ScoreSmoother, TriggerDetector, shouldGateByVad } from './dsp'

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let config: KWSConfig = { ...DEFAULT_CONFIG }

let backend: KWSBackend | null = null
let embedProvider: PlixKwsEmbedProvider | null = null
let actualExecutionProvider: 'webgpu' | 'wasm' = 'wasm'

// Generic inference state (backend-agnostic).
let smoother = new ScoreSmoother(config.smoothingWindowFrames)
const trigger = new TriggerDetector(
  config.threshold,
  config.minDurationMs,
  config.cooldownMs,
  'hey-buddy',
)

// Serialization guards: ONNX InferenceSessions are not re-entrant. The AFE
// delivers a frame every ~10 ms, but inference (mel -> embedding -> classifier)
// can take longer. Each KWSBackend owns its own guard now (moved from the worker
// so backends can buffer every frame); this `embedding` flag guards the
// `handleEmbed` enrollment path (PLiX) which is separate from detection.
let embedding = false

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function post(msg: KWSMainMessage): void {
  postMessage(msg)
}

function postError(message: string): void {
  post({ type: 'error', message })
}

/** Detect the best available execution provider (WebGPU-first, ADR-018). */
async function detectExecutionProvider(): Promise<'webgpu' | 'wasm'> {
  // navigator.gpu is available in workers in modern browsers.
  if (typeof navigator !== 'undefined' && 'gpu' in navigator) {
    try {
      const adapter = await (
        navigator as unknown as { gpu: { requestAdapter: () => Promise<unknown> } }
      ).gpu.requestAdapter()
      if (adapter) return 'webgpu'
    } catch {
      // WebGPU not usable; fall through to WASM.
    }
  }
  return 'wasm'
}

// ---------------------------------------------------------------------------
// Message handlers
// ---------------------------------------------------------------------------

async function handleLoad(
  backendId: KWSBackendId,
  urls: BackendModelUrls,
  prototypeVector?: number[],
  asrConfig?: Partial<AsrDecodeConfig>,
  sherpaKwsConfig?: Partial<SherpaOnnxKwsConfig>,
): Promise<void> {
  actualExecutionProvider =
    config.executionProvider === 'webgpu'
      ? await detectExecutionProvider()
      : 'wasm'

  // Global model-runtime hint (ADR-002 amendment). Per-URL `runtime` overrides
  // it; otherwise fall back to the config-level hint, then the default.
  const globalRuntime = urls.runtime ?? config.runtime ?? DEFAULT_MODEL_RUNTIME

  try {
    // PLiX encoder is required for the plixkws backend AND for the embed()
    // scaffold. Load it first. A load failure here is a hard error - we do NOT
    // swallow it (silencing it would only surface later as the cryptic
    // "PLiX encoder not loaded; embed() unavailable" from handleEmbed). If the
    // requested PLiX URL/runtime cannot load, fail loudly so the UI can show
    // the real reason (e.g. a missing ONNX graph or external-data file).
    if (urls.plixkws) {
      const runtime = globalRuntime
      embedProvider = new PlixKwsEmbedProvider(urls.plixkws, runtime)
      await embedProvider.load(urls.plixkws, actualExecutionProvider)
    }

    // Tracks whether a GPU-capable detection backend was actually loaded. The
    // PLiX embedder is always pinned to WASM (its ONNX graph is incompatible
    // with ORT-Web's WebGPU EP - see PlixKwsEmbedProvider). So the EP reported
    // to the UI is only 'webgpu' when a WebGPU-feasible detection backend is
    // loaded; otherwise it is 'wasm' even if WebGPU is available.
    let gpuBackendLoaded = false

    if (backendId === 'asr-decode') {
      // ASR-Decoding KWS (ADR-024): no ONNX models; the "model" is a streaming
      // ASR engine + an editable wake-word list. Configure and load it.
      const asr = new AsrDecodeBackend()
      asr.configure(asrConfig ?? {})
      await asr.load(undefined as never, actualExecutionProvider)
      backend = asr
      // ASR runs on sherpa-onnx's own wasm; report wasm to the UI.
      post({ type: 'loaded', executionProvider: 'wasm' })
      return
    }

    if (backendId === 'sherpa-onnx-kws') {
      // Direct keyword spotting via sherpa-onnx KWS wasm (ADR-020). The model
      // graph + tokens are prebuilt into the wasm .data bundle; we only need
      // the wasm base URL + keyword list.
      const kws = new SherpaOnnxKwsBackend()
      kws.configure(sherpaKwsConfig ?? {})
      await kws.load(undefined as never, actualExecutionProvider)
      backend = kws
      // sherpa-onnx KWS runs on its own single-threaded wasm; report wasm.
      post({ type: 'loaded', executionProvider: 'wasm' })
      return
    }

    if (backendId === 'plixkws') {
      // Few-Shot backend: reuse the shared PLiX embedProvider + the prototype.
      if (!embedProvider || !embedProvider.ready) {
        throw new Error(
          'PLiX Few-Shot backend requires a loaded PLiX encoder (provide a plixkws URL).',
        )
      }
      if (!prototypeVector || prototypeVector.length === 0) {
        throw new Error(
          'PLiX Few-Shot backend requires a prototype vector in the load message.',
        )
      }
      const proto = {
        id: 'enrolled',
        word: 'enrolled-word',
        vector: new Float32Array(prototypeVector),
        sampleIds: [],
        createdAtMs: Date.now(),
      }
      backend = new PlixKwsBackend(
        embedProvider,
        proto,
        1500,
        false,
      )
    } else {
      // Detection backend: only load if its required URLs are present. If only
      // plixkws is provided (Few-Shot enrollment / embed-only mode), skip the
      // detection backend - embed() still works via the PLiX provider above.
      const hasDetectionUrls =
        urls.melspectrogram && urls.embedding && urls.classifier
      if (hasDetectionUrls) {
        backend = createBackend(backendId)
        await backend.load(urls, actualExecutionProvider)
        // OpenWakeWord (and similar) actually exercise the WebGPU EP.
        gpuBackendLoaded = true
      }
    }

    const reportedEp: 'webgpu' | 'wasm' =
      actualExecutionProvider === 'webgpu' && gpuBackendLoaded
        ? 'webgpu'
        : 'wasm'
    post({ type: 'loaded', executionProvider: reportedEp })
  } catch (err) {
    postError(
      `Model load failed: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

function handleConfig(newConfig: KWSConfig): void {
  const oldWindow = config.smoothingWindowFrames
  config = newConfig
  // Rebuild the smoother only if the window size actually changed.
  if (newConfig.smoothingWindowFrames !== oldWindow) {
    smoother = new ScoreSmoother(newConfig.smoothingWindowFrames)
  }
  trigger.configure(
    newConfig.threshold,
    newConfig.minDurationMs,
    newConfig.cooldownMs,
  )
}

async function handleAudio(
  samples: Float32Array,
  capturedAtMs: number,
  vadProbability: number,
): Promise<void> {
  if (!backend || !backend.ready) return

  // VAD state for this frame. The gate now SUPPRESSES TRIGGERS during silence,
  // it does NOT skip inference. Skipping inference would drop wake-word audio
  // from the backend's sliding mel window (RNNoise's VAD is conservative at
  // utterance onset, so the first phonemes would be lost and triggering would
  // become difficult). Always feeding audio keeps the window current; the gate
  // only prevents a trigger from firing during silence (false-alarm suppression).
  const vadSuppressed = shouldGateByVad(
    vadProbability,
    config.vadThreshold,
    config.vadGateEnabled,
  )

  // Backend inference (ADR-020). Returns null during warmup.
  //
  // Concurrency: each backend owns its own serialization guard (ONNX sessions
  // are not re-entrant). The worker always calls processFrame so the backend
  // can buffer every frame (the PLiX Few-Shot backend needs a continuous
  // window; the OpenWakeWord backend tolerates dropped frames). The backend
  // returns null or a cached score when its inference is in flight.
  let score: number | null
  try {
    score = await backend.processFrame(samples)
  } catch (err) {
    postError(
      `Inference failed: ${err instanceof Error ? err.message : String(err)}`,
    )
    return
  }

  if (score === null) {
    // Warmup (backend accumulating mel frames / embeddings). Post a 0 so the
    // score curve renders from the start rather than gaping for ~2 s.
    const smoothed = smoother.push(0)
    post({
      type: 'score',
      sample: {
        capturedAtMs,
        rawScore: 0,
        smoothedScore: smoothed,
        triggered: false,
        vadProbability,
      },
    })
    return
  }

  const smoothed = smoother.push(score)
  // Always run the trigger detector so its min-duration state stays consistent
  // (it naturally resets when the score drops below threshold). Suppress only
  // the trigger *event* during VAD-off silence (false-alarm suppression).
  const rawTrigger = trigger.process(smoothed, capturedAtMs)
  const triggerEvent = vadSuppressed ? null : rawTrigger

  post({
    type: 'score',
    sample: {
      capturedAtMs,
      rawScore: score,
      smoothedScore: smoothed,
      triggered: triggerEvent !== null,
      vadProbability,
    },
  })

  if (triggerEvent) {
    post({ type: 'trigger', event: triggerEvent })
  }

  // ASR-Decoding backend: surface the streaming partial transcript so the UI
  // can show live decoded text (does not affect the standardized score/trigger
  // event shape consumed by the rest of the app).
  if (backend && (backend as unknown as { lastPartialText?: string }).lastPartialText) {
    post({
      type: 'partial',
      text: (backend as unknown as { lastPartialText: string }).lastPartialText,
    })
  }
}

async function handleEmbed(
  requestId: number,
  samples: Float32Array,
  sampleRate: number,
): Promise<void> {
  if (!embedProvider || !embedProvider.ready) {
    postError('PLiX encoder not loaded; embed() unavailable.')
    return
  }

  // Serialization: PLiX's session is not re-entrant either.
  if (embedding) {
    postError('Embed already in progress; retry after the current request completes.')
    return
  }
  embedding = true
  try {
    const embeddingResult = await embedProvider.embed(samples, sampleRate)
    post({ type: 'embed-result', requestId, embedding: embeddingResult })
  } catch (err) {
    postError(
      `Embed failed: ${err instanceof Error ? err.message : String(err)}`,
    )
  } finally {
    embedding = false
  }
}

// ---------------------------------------------------------------------------
// Worker entry point
// ---------------------------------------------------------------------------

self.onmessage = async (e: MessageEvent<KWSWorkerMessage>) => {
  const msg = e.data
  try {
    switch (msg.type) {
      case 'load':
        await handleLoad(msg.backend, msg.models, msg.prototype, msg.asrConfig, msg.sherpaKwsConfig)
        break
      case 'config':
        handleConfig(msg.config)
        break
      case 'audio':
        await handleAudio(msg.samples, msg.capturedAtMs, msg.vadProbability)
        break
      case 'embed':
        await handleEmbed(msg.requestId, msg.samples, msg.sampleRate)
        break
      case 'stop':
        // Reset detection state but keep models loaded so start/stop/start
        // works without a reload. (Full teardown is worker.terminate().)
        await backend?.reset()
        smoother.reset()
        trigger.reset()
        break
    }
  } catch (err) {
    postError(
      `Worker error: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}
