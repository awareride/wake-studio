/**
 * KWS Web Worker - backend-agnostic inference loop (ADR-018, ADR-020).
 *
 * Runs off-main-thread to avoid blocking the UI. The worker owns the generic
 * loop (VAD gate, score smoothing, trigger) and delegates model-specific
 * inference to a pluggable {@link KWSBackend} (ADR-020). It also hosts an
 * optional {@link WavLMEmbedProvider} for the Few-Shot `embed()` scaffold
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
import { createBackend } from './backend'
import { WavLMEmbedProvider } from './backends/wavlm-embed'
import { WavLMFewShotBackend } from './backends/wavlm-few-shot'
import { DEFAULT_CONFIG } from './defaults'
import { ScoreSmoother, TriggerDetector, shouldGateByVad } from './dsp'

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let config: KWSConfig = { ...DEFAULT_CONFIG }

let backend: KWSBackend | null = null
let embedProvider: WavLMEmbedProvider | null = null
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
// can take longer. Without these guards, a second processFrame()/embed() call
// would hit session.run() while the first is still in flight, producing
// "Session already started". When a guard is set, the incoming frame/request
// is dropped (documented behavior, kws.md §7: "drop the oldest frames").
let inferring = false
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
): Promise<void> {
  actualExecutionProvider =
    config.executionProvider === 'webgpu'
      ? await detectExecutionProvider()
      : 'wasm'

  try {
    // WavLM is required for the wavlm-few-shot backend AND for the embed()
    // scaffold. Load it first.
    if (urls.wavlm) {
      try {
        embedProvider = new WavLMEmbedProvider()
        await embedProvider.load(urls.wavlm, actualExecutionProvider)
      } catch {
        embedProvider = null
      }
    }

    if (backendId === 'wavlm-few-shot') {
      // Few-Shot backend: reuse the shared WavLM embedProvider + the prototype.
      if (!embedProvider || !embedProvider.ready) {
        throw new Error(
          'WavLM Few-Shot backend requires a loaded WavLM encoder (provide a wavlm URL).',
        )
      }
      if (!prototypeVector || prototypeVector.length === 0) {
        throw new Error(
          'WavLM Few-Shot backend requires a prototype vector in the load message.',
        )
      }
      const proto = {
        id: 'enrolled',
        word: 'enrolled-word',
        vector: new Float32Array(prototypeVector),
        sampleIds: [],
        createdAtMs: Date.now(),
      }
      backend = new WavLMFewShotBackend(
        embedProvider,
        proto,
        1500,
        false,
      )
    } else {
      backend = createBackend(backendId)
      await backend.load(urls, actualExecutionProvider)
    }

    post({ type: 'loaded', executionProvider: actualExecutionProvider })
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

  // VAD gate: skip inference if VAD is below threshold (ADR-018).
  if (
    shouldGateByVad(vadProbability, config.vadThreshold, config.vadGateEnabled)
  ) {
    // Still post a low-score sample so the curve doesn't gap.
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

  // Backend inference (ADR-020). Returns null during warmup.
  //
  // Serialization: if the previous frame's inference is still in flight, drop
  // this frame. ONNX sessions are not re-entrant ("Session already started").
  // The backend's sliding mel window retains enough context that dropping a
  // few 10 ms frames does not break detection (kws.md §7).
  if (inferring) return
  inferring = true
  let score: number | null
  try {
    score = await backend.processFrame(samples)
  } catch (err) {
    postError(
      `Inference failed: ${err instanceof Error ? err.message : String(err)}`,
    )
    return
  } finally {
    inferring = false
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
  const triggerEvent = trigger.process(smoothed, capturedAtMs)

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
}

async function handleEmbed(
  requestId: number,
  samples: Float32Array,
  sampleRate: number,
): Promise<void> {
  if (!embedProvider || !embedProvider.ready) {
    postError('WavLM model not loaded; embed() unavailable.')
    return
  }

  // Serialization: WavLM's session is not re-entrant either.
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
        await handleLoad(msg.backend, msg.models, msg.prototype)
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
