/**
 * KWS Web Worker - backend-agnostic inference loop (ADR-018, ADR-020).
 *
 * Runs off-main-thread to avoid blocking the UI. The worker owns the generic
 * loop (VAD gate, score smoothing, trigger) and delegates model-specific
 * inference to a pluggable {@link KWSBackend} (ADR-020). It also hosts an
 * optional {@link PlixKwsEmbedProvider} for the Few-Shot `embed()` scaffold
 * (Phase 3), independent of the detection backend.
 *
 * Pure logic (ScoreSmoother, TriggerDetector, VAD gate) is in ./logic.
 *
 * Driver registration (issue #23): this worker runs in a SEPARATE bundle
 * (Vite `?worker`), so driver modules must be imported HERE for their
 * registration side-effects (`registerKwsBackend` / `registerEmbedProviderFactory`)
 * to run inside the worker. The engine core (core/) still never imports a
 * driver module (ADR-024); this file is in the web target, not core. New
 * drivers only need to be added to the import list below (or by the host via
 * the worker-assembly seam).
 */

// Driver registration side-effects (must run once, before any load message).
// Imported as namespaces and referenced via `void` so Vite cannot tree-shake
// the side-effect imports out of the worker bundle.
import * as openWakeWordDriver from '@wake-studio/module-kws-openwakeword'
import * as sherpaDriver from '@wake-studio/module-kws-sherpa'
import * as plixDriver from '@wake-studio/module-kws-plix'
import * as streamingDriver from '@wake-studio/module-kws-streaming'
void openWakeWordDriver.OpenWakeWordBackend
void sherpaDriver.SherpaOnnxKwsBackend
void plixDriver.PlixKwsBackend
void streamingDriver.KWSStreamingBackend

import type {
  BackendModelUrls,
  KWSBackend,
  KWSBackendId,
  KWSConfig,
  KWSMainMessage,
  KWSWorkerMessage,
  EmbedProvider,
} from '../core/types'
import { DEFAULT_MODEL_RUNTIME } from '@wake-studio/platform'
import {
  backendHasRequiredUrls,
  createBackend,
  createEmbedProvider,
} from '../core/backend'
import { DEFAULT_CONFIG } from '../core/defaults'
import { ScoreSmoother, TriggerDetector, shouldGateByVad } from '../core/logic'

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let config: KWSConfig = { ...DEFAULT_CONFIG }

let backend: KWSBackend | null = null
let embedProvider: EmbedProvider | null = null
let actualExecutionProvider: 'webgpu' | 'wasm' = 'wasm'

// Generic inference state (backend-agnostic).
let smoother = new ScoreSmoother(config.smoothingWindowFrames)
/**
 * Last real score from the backend (sample-and-hold).
 *
 * Backends score at their own cadence, slower than the 10 ms AFE frame rate
 * (kws-streaming: once per 100 ms hop; openwakeword: once per 1280-sample
 * chunk). Between scores `processFrame` returns null, which means "no new
 * score" - NOT "zero". Holding the last value keeps the smoothed signal
 * continuous so the min-duration trigger can actually accumulate.
 */
let lastScore: number | null = null
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
  backendConfig?: unknown,
  prototypeNegative?: number[],
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
      embedProvider = (await createEmbedProvider(
        urls.plixkws,
        runtime,
      )) as EmbedProvider | null
      if (embedProvider) {
        await (embedProvider as unknown as { load: (u: string, p: string) => Promise<void> }).load(
          urls.plixkws,
          actualExecutionProvider,
        )
      }
    }

    // Tracks whether a GPU-capable detection backend was actually loaded. The
    // PLiX embedder is always pinned to WASM (its ONNX graph is incompatible
    // with ORT-Web's WebGPU EP - see PlixKwsEmbedProvider). So the EP reported
    // to the UI is only 'webgpu' when a WebGPU-feasible detection backend is
    // loaded; otherwise it is 'wasm' even if WebGPU is available.
    let gpuBackendLoaded = false

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
        // Negative-class prototype (open-set rejection, issue #69): the user
        // enrolled other words/background; scoring subtracts this class's
        // distance so non-target speech scores low.
        negativeVector: prototypeNegative
          ? new Float32Array(prototypeNegative)
          : undefined,
        sampleIds: [],
        createdAtMs: Date.now(),
      }
      // The plixkws detection backend is created through the registry so the
      // worker stays decoupled from the plix driver module (ADR-024). It
      // expects the shared embedProvider + prototype, plus optional
      // windowMs / useNegativePrototype from the workspace config (epic #53
      // P1) threaded via backendConfig.
      backend = createBackend('plixkws')
      await (
        backend as KWSBackend & {
          initWithPrototype?: (
            p: unknown,
            e: unknown,
            opts?: {
              windowMs?: number
              useNegative?: boolean
              silenceFloorDbfs?: number
            },
          ) => void
        }
      ).initWithPrototype?.(proto, embedProvider, {
        windowMs: (backendConfig as { windowMs?: number } | undefined)?.windowMs,
        useNegative: (backendConfig as { useNegative?: boolean } | undefined)?.useNegative,
        silenceFloorDbfs: (backendConfig as { silenceFloorDbfs?: number } | undefined)?.silenceFloorDbfs,
      })
    } else {
      // Detection backend: only load if its required URLs are present. If only
      // plixkws is provided (Few-Shot enrollment / embed-only mode), skip the
      // detection backend - embed() still works via the PLiX provider above.
      //
      // Each driver needs a different URL set, so "do we have what this
      // backend needs?" is answered by the driver's own registration
      // (`hasRequiredUrls`, ADR-024) rather than by assuming the openwakeword
      // triple - that assumption silently skipped loading for any other
      // driver, leaving the engine ready-but-deaf.
      const hasDetectionUrls = backendHasRequiredUrls(backendId, urls)
      if (hasDetectionUrls) {
        backend = createBackend(backendId)
        // Drivers with their own params (e.g. kws-streaming's wantedWord)
        // consume them through the optional configure() capability before load.
        ;(backend as KWSBackend & { configure?: (c: unknown) => void }).configure?.(
          backendConfig ?? {},
        )
        await backend.load(urls, actualExecutionProvider)
        // Whether the GPU was really used is the BACKEND's fact, not an
        // assumption: some drivers pin WASM regardless of the request (e.g.
        // kws-streaming, whose graph hits a WebGPU/jsep Squeeze bug; plix's
        // embedder likewise). A backend may expose `effectiveExecutionProvider`
        // to report what it actually created the session with; otherwise we
        // trust the requested provider.
        const backendEp = (
          backend as KWSBackend & { effectiveExecutionProvider?: 'webgpu' | 'wasm' }
        ).effectiveExecutionProvider
        gpuBackendLoaded = (backendEp ?? actualExecutionProvider) === 'webgpu'
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
    lastScore = null
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
    // `null` means "no NEW score this frame", not "the score is zero".
    //
    // Backends score at their own cadence, slower than the 10 ms AFE frame
    // rate: the kws-streaming sliding-window driver evaluates once per hop
    // (100 ms = every 10th frame), openwakeword once per 1280-sample chunk.
    //
    // This is NOT the cause of the never-triggers bug (that was a seconds/ms
    // unit mismatch in `capturedAtMs` - see tests/score-cadence.test.ts): the
    // early `return` below means the trigger detector never advanced on these
    // frames at all. But pushing a hard 0 made the SCORE CURVE sawtooth
    // between 0 and the real score, which reads as a broken detector and hides
    // the actual confidence. Carry the last value forward instead
    // (sample-and-hold), so the curve shows what the backend actually last
    // reported. Before the first score (true warmup) emit 0 so the curve
    // renders from the start rather than gaping.
    if (lastScore === null) {
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
    score = lastScore
  } else {
    lastScore = score
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
        await handleLoad(msg.backend, msg.models, msg.prototype, msg.backendConfig, msg.prototypeNegative)
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
        // Drop the held score too, or the next session would start by holding a
        // stale (possibly above-threshold) value from the previous run.
        lastScore = null
        break
    }
  } catch (err) {
    postError(
      `Worker error: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}
