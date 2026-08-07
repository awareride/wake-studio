/**
 * KWS main-thread controller.
 *
 * Manages the KWS Web Worker, subscriptions to AFE output, and the message
 * protocol between the main thread and the worker. Implements the KWSEngine
 * public API from docs/modules/kws.md §4.
 */

import type {
  AFEOutputFrame,
} from '@wake-studio/module-afe-graph'
import type {
  BackendModelUrls,
  KWSConfig,
  KWSScoreSample,
  KWSTriggerEvent,
  KWSStatus,
  KWSMainMessage,
  KWSWorkerMessage,
  ParameterDescriptor,
} from './types'
import type { KWSBackend } from './types'
import { DEFAULT_CONFIG } from './defaults'
import { describeParameters } from './defaults'
import { KWSLoadError } from './types'
import { ScoreSmoother, TriggerDetector, shouldGateByVad } from './logic'
import { createMainThreadBackend } from './backend'

// The KWS Web Worker is created through the worker-assembly seam (ADR-024,
// issue #23): importing the assembly wires the driver registration
// side-effects into the worker bundle. It is imported DYNAMICALLY at
// worker-creation time (not statically): a static import would create an
// import cycle (engine core -> assembly -> driver -> engine core) whose
// evaluation order leaves the engine's backend registry uninitialized when a
// driver calls registerKwsBackend (TDZ ReferenceError). By the time load()
// runs, every module is fully evaluated, so the cycle is resolved safely.
// The engine core still never imports a driver module (ADR-024).

type ScoreCallback = (sample: KWSScoreSample) => void
type TriggerCallback = (event: KWSTriggerEvent) => void
type PartialCallback = (text: string) => void

export class KWSEngine {
  private _worker: Worker | null = null
  private _config: KWSConfig = { ...DEFAULT_CONFIG }
  private _status: KWSStatus = 'idle'
  private _executionProvider: 'webgpu' | 'wasm' = 'wasm'

  private _scoreCallbacks = new Set<ScoreCallback>()
  private _triggerCallbacks = new Set<TriggerCallback>()
  private _partialCallbacks = new Set<PartialCallback>()
  private _afeUnsubscribe: (() => void) | null = null

  // embed() promise tracking.
  private _embedCounter = 0
  private _embedResolvers = new Map<number, (embedding: Float32Array) => void>()

  // The sherpa-onnx-kws wasm is a *classic* emscripten module that requires a
  // DOM (`document` + a global Module), so it cannot run inside the (DOM-less)
  // Web Worker. It is therefore loaded and driven on the MAIN THREAD; all other
  // backends run in the worker. When set, AFE frames are processed here.
  private _mainThreadBackend: KWSBackend | null = null
  private _smoother: ScoreSmoother | null = null
  private _trigger: TriggerDetector | null = null

  // ---- public readonly state ----

  get status(): KWSStatus {
    return this._status
  }

  get ready(): boolean {
    return this._status === 'ready' || this._status === 'running'
  }

  get running(): boolean {
    return this._status === 'running'
  }

  get config(): KWSConfig {
    return this._config
  }

  get executionProvider(): 'webgpu' | 'wasm' {
    return this._executionProvider
  }

  // ---- lifecycle ----

  /**
   * Load models from the registry (ADR-011) into the selected backend
   * (ADR-020). The backend id comes from `config.backend`. For the
   * `plixkws` backend, pass the enrolled prototype vector. Resolves
   * when ready to detect.
   */
  async load(
    models: BackendModelUrls,
    prototype?: Float32Array,
    backendConfig?: unknown,
  ): Promise<void> {
    // Guard only against a concurrent load (in-flight). A `ready` engine may
    // be re-loaded (Reload button, or a backend switch after stop): the old
    // worker/backend must be torn down first so the new backend actually
    // boots (previously the ready-guard silently kept the stale backend,
    // making detection fail after a switch).
    if (this._status === 'loading') return

    if (this._status === 'ready') {
      // Explicit re-load: dispose the previous session (worker or
      // main-thread backend) so the new backend/config take effect.
      this._teardownBackend()
    }

    this._status = 'loading'

    // Some backends need the DOM (e.g. sherpa-onnx-kws's classic emscripten
    // wasm injects <script> tags), so they cannot boot inside the DOM-less Web
    // Worker. The engine dispatches on capability, not id: if the selected
    // backend registered a mainThreadFactory (ADR-024 decoupling), drive it on
    // the main thread; otherwise run it in the worker.
    const mainThreadBackend = createMainThreadBackend(this._config.backend)
    if (mainThreadBackend) {
      try {
        // The main-thread backend exposes configure(config) for its own params
        // (e.g. sherpa keywords + wasm base URL). Driver-specific; passed
        // through as-is from the host.
        ;(mainThreadBackend as KWSBackend & { configure?: (c: unknown) => void }).configure?.(backendConfig ?? {})
        await mainThreadBackend.load(undefined as never, 'wasm')
        this._mainThreadBackend = mainThreadBackend
        this._smoother = new ScoreSmoother(this._config.smoothingWindowFrames)
        this._trigger = new TriggerDetector(
          this._config.threshold,
          this._config.minDurationMs,
          this._config.cooldownMs,
          this._config.backend,
        )
        this._executionProvider = 'wasm'
        this._status = 'ready'
        return
      } catch (err) {
        this._status = 'error'
        throw new KWSLoadError(
          err instanceof Error ? err.message : String(err),
        )
      }
    }

    await this._ensureWorker()

    return new Promise<void>((resolve, reject) => {
      const onMessage = (e: MessageEvent<KWSMainMessage>) => {
        const msg = e.data
        if (msg.type === 'loaded') {
          this._executionProvider = msg.executionProvider
          this._status = 'ready'
          this._worker!.removeEventListener('message', onMessage)
          // Send initial config.
          this._sendConfig()
          resolve()
        } else if (msg.type === 'error') {
          this._status = 'error'
          this._worker!.removeEventListener('message', onMessage)
          reject(new KWSLoadError(msg.message))
        }
      }
      this._worker!.addEventListener('message', onMessage)
      this._send({
        type: 'load',
        backend: this._config.backend,
        models,
        prototype: prototype ? Array.from(prototype) : undefined,
        // Pass the driver backend config into the worker (e.g. plixkws
        // windowMs / useNegativePrototype, epic #53 P1).
        backendConfig,
      })
    })
  }

  /** Start detection. Subscribes to the AFE output stream. */
  start(afe: {
    onOutput: (cb: (f: AFEOutputFrame) => void) => () => void
  }): void {
    if (this._status !== 'ready') return
    this._status = 'running'
    this._afeUnsubscribe = afe.onOutput((frame) => this._onAfeFrame(frame))
  }

  stop(): void {
    if (this._afeUnsubscribe) {
      this._afeUnsubscribe()
      this._afeUnsubscribe = null
    }
    if (this._mainThreadBackend) {
      this._mainThreadBackend.reset()
      this._smoother?.reset()
      this._trigger?.reset()
    } else if (this._worker) {
      this._send({ type: 'stop' })
    }
    // Back to ready: models stay loaded, detection is stopped, and the user
    // can start again (or reload). A subsequent load() re-boots the backend
    // (the ready-guard was removed from load, see load()).
    this._status = 'ready'
  }

  /** Destroy the worker and release resources. */
  dispose(): void {
    this._teardownBackend()
    this._scoreCallbacks.clear()
    this._triggerCallbacks.clear()
    this._partialCallbacks.clear()
    this._status = 'idle'
  }

  /**
   * Tear down the current inference session (worker or main-thread backend)
   * so a fresh one can boot. Keeps the subscription callbacks; a subsequent
   * load() recreates the worker/backend.
   */
  private _teardownBackend(): void {
    this.stop()
    if (this._mainThreadBackend) {
      void this._mainThreadBackend.dispose()
      this._mainThreadBackend = null
      this._smoother = null
      this._trigger = null
    }
    if (this._worker) {
      this._worker.terminate()
      this._worker = null
    }
  }

  // ---- subscriptions ----

  onScore(cb: ScoreCallback): () => void {
    this._scoreCallbacks.add(cb)
    return () => this._scoreCallbacks.delete(cb)
  }

  onTrigger(cb: TriggerCallback): () => void {
    this._triggerCallbacks.add(cb)
    return () => this._triggerCallbacks.delete(cb)
  }

  /** Subscribe to the streaming partial transcript (sherpa-onnx-kws backend). */
  onPartial(cb: PartialCallback): () => void {
    this._partialCallbacks.add(cb)
    return () => this._partialCallbacks.delete(cb)
  }

  // ---- config panel (ADR-017) ----

  setConfig(patch: Partial<KWSConfig>): void {
    this._config = { ...this._config, ...patch }
    if (this._smoother && patch.smoothingWindowFrames !== undefined) {
      this._smoother = new ScoreSmoother(patch.smoothingWindowFrames)
    }
    if (this._trigger) {
      this._trigger.configure(
        this._config.threshold,
        this._config.minDurationMs,
        this._config.cooldownMs,
      )
    }
    this._sendConfig()
  }

  describeParameters(): ReadonlyArray<ParameterDescriptor> {
    return describeParameters()
  }

  // ---- Few-Shot scaffold (Phase 3) ----

  async embed(audio: Float32Array, sampleRate: number): Promise<Float32Array> {
    if (!this._worker || !this.ready) {
      throw new Error('KWS engine is not ready.')
    }
    const requestId = ++this._embedCounter
    return new Promise<Float32Array>((resolve) => {
      this._embedResolvers.set(requestId, resolve)
      this._send({ type: 'embed', requestId, samples: audio, sampleRate })
    })
  }

  // ---- internals ----

  private async _ensureWorker(): Promise<void> {
    if (this._worker) return
    // Dynamic import: resolves the engine<->driver import cycle at runtime
    // (see comment above). Vite/Rollup splits this into a separate chunk.
    const { createKwsWorker } = await import('../web/worker-assembly')
    this._worker = createKwsWorker()
    this._worker!.onmessage = (e: MessageEvent<KWSMainMessage>) => {
      this._handleMessage(e.data)
    }
  }

  private _send(msg: KWSWorkerMessage): void {
    this._worker?.postMessage(msg)
  }

  private _sendConfig(): void {
    this._send({ type: 'config', config: this._config })
  }

  private _onAfeFrame(frame: AFEOutputFrame): void {
    // Convert vadActive (boolean) to a probability approximation.
    // The AFE provides vadActive (boolean from RNNoise VAD > 0.5); for the gate
    // we need a probability. Use 1.0 if active, 0.0 if not (ADR-018).
    const vadProbability = frame.vadActive ? 1.0 : 0.0

    // Main-thread backend (sherpa-onnx-kws): run inference + smoothing here.
    if (this._mainThreadBackend && this._smoother && this._trigger) {
      this._processMainThread(frame.samples, frame.capturedAtMs, vadProbability)
      return
    }

    this._send({
      type: 'audio',
      samples: frame.samples,
      capturedAtMs: frame.capturedAtMs,
      vadProbability,
    })
  }

  /** Drive the main-thread sherpa-onnx-kws backend + smoothing/trigger. */
  private async _processMainThread(
    samples: Float32Array,
    capturedAtMs: number,
    vadProbability: number,
  ): Promise<void> {
    const backend = this._mainThreadBackend!
    const smoother = this._smoother!
    const trigger = this._trigger!

    let score: number | null
    try {
      score = await backend.processFrame(samples)
    } catch (err) {
      console.error('[KWS sherpa-onnx-kws]', err)
      return
    }
    if (score === null) score = 0

    const smoothed = smoother.push(score)
    const vadSuppressed = shouldGateByVad(
      vadProbability,
      this._config.vadThreshold,
      this._config.vadGateEnabled,
    )
    const rawTrigger = trigger.process(smoothed, capturedAtMs)
    const triggerEvent = vadSuppressed ? null : rawTrigger

    this._scoreCallbacks.forEach((cb) =>
      cb({
        capturedAtMs,
        rawScore: score,
        smoothedScore: smoothed,
        triggered: triggerEvent !== null,
        vadProbability,
      }),
    )
    if (triggerEvent) {
      this._triggerCallbacks.forEach((cb) => cb(triggerEvent))
    }
    const lastKeyword = (backend as unknown as { lastPartialText?: string })
      .lastPartialText
    if (lastKeyword) {
      this._partialCallbacks.forEach((cb) => cb(lastKeyword))
    }
  }

  private _handleMessage(msg: KWSMainMessage): void {
    switch (msg.type) {
      case 'score':
        this._scoreCallbacks.forEach((cb) => cb(msg.sample))
        break
      case 'trigger':
        this._triggerCallbacks.forEach((cb) => cb(msg.event))
        break
      case 'partial':
        this._partialCallbacks.forEach((cb) => cb(msg.text))
        break
      case 'embed-result': {
        const resolver = this._embedResolvers.get(msg.requestId)
        if (resolver) {
          resolver(msg.embedding)
          this._embedResolvers.delete(msg.requestId)
        }
        break
      }
      case 'error':
        console.error('[KWS worker]', msg.message)
        break
    }
  }
}
