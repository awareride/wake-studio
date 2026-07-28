/**
 * KWS main-thread controller.
 *
 * Manages the KWS Web Worker, subscriptions to AFE output, and the message
 * protocol between the main thread and the worker. Implements the KWSEngine
 * public API from docs/modules/kws.md §4.
 */

import type {
  AFEOutputFrame,
} from '../afe'
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
import { DEFAULT_CONFIG } from './defaults'
import { describeParameters } from './defaults'
import { KWSLoadError } from './types'

// Vite bundles the worker into a separate file.
import KWSWorker from './worker?worker'

type ScoreCallback = (sample: KWSScoreSample) => void
type TriggerCallback = (event: KWSTriggerEvent) => void

export class KWSEngine {
  private _worker: Worker | null = null
  private _config: KWSConfig = { ...DEFAULT_CONFIG }
  private _status: KWSStatus = 'idle'
  private _executionProvider: 'webgpu' | 'wasm' = 'wasm'

  private _scoreCallbacks = new Set<ScoreCallback>()
  private _triggerCallbacks = new Set<TriggerCallback>()
  private _afeUnsubscribe: (() => void) | null = null

  // embed() promise tracking.
  private _embedCounter = 0
  private _embedResolvers = new Map<number, (embedding: Float32Array) => void>()

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
   * `wavlm-few-shot` backend, pass the enrolled prototype vector. Resolves
   * when ready to detect.
   */
  async load(models: BackendModelUrls, prototype?: Float32Array): Promise<void> {
    if (this._status === 'loading' || this._status === 'ready') return

    this._status = 'loading'
    this._ensureWorker()

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
    this._send({ type: 'stop' })
    this._status = 'ready'
  }

  /** Destroy the worker and release resources. */
  dispose(): void {
    this.stop()
    this._scoreCallbacks.clear()
    this._triggerCallbacks.clear()
    if (this._worker) {
      this._worker.terminate()
      this._worker = null
    }
    this._status = 'idle'
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

  // ---- config panel (ADR-017) ----

  setConfig(patch: Partial<KWSConfig>): void {
    this._config = { ...this._config, ...patch }
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

  private _ensureWorker(): void {
    if (this._worker) return
    this._worker = new KWSWorker()
    this._worker.onmessage = (e: MessageEvent<KWSMainMessage>) => {
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
    this._send({
      type: 'audio',
      samples: frame.samples,
      capturedAtMs: frame.capturedAtMs,
      vadProbability,
    })
  }

  private _handleMessage(msg: KWSMainMessage): void {
    switch (msg.type) {
      case 'score':
        this._scoreCallbacks.forEach((cb) => cb(msg.sample))
        break
      case 'trigger':
        this._triggerCallbacks.forEach((cb) => cb(msg.event))
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
