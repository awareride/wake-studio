/**
 * kws-engine - KWSEngine reload semantics (regression test).
 *
 * Bug: load() early-returned when `status === 'ready'`, so after the user
 * loaded a backend, stopped detection, switched to another backend and hit
 * Reload, the stale worker (old backend) was kept alive and detection silently
 * failed on the new backend. This test pins the fixed contract:
 *
 *   - load() while `ready` tears down the previous worker and boots a fresh
 *     one (so a backend switch actually takes effect), and
 *   - stop() keeps the engine ready to start again (models stay loaded).
 *
 * The worker is Vite-bundled (`?worker`); in Node we stub `Worker`/`postMessage`
 * and drive the engine's message listener directly.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { KWSEngine } from '../core/KWSEngine'

// KWSEngine creates its worker via a dynamic import of the worker-assembly
// seam (which imports the Vite `?worker` bundle). In Node that suffix cannot
// resolve, so mock the seam to hand back our FakeWorker constructor.
const mocks = vi.hoisted(() => ({
  createKwsWorker: vi.fn(),
}))
vi.mock('../web/worker-assembly', () => ({
  createKwsWorker: mocks.createKwsWorker,
}))

/** A fake Worker that records messages and lets the test reply. */class FakeWorker {
  static instances: FakeWorker[] = []
  messages: unknown[] = []
  terminated = false
  private listeners = new Set<(e: MessageEvent) => void>()

  constructor() {
    FakeWorker.instances.push(this)
  }

  postMessage(msg: unknown): void {
    this.messages.push(msg)
  }

  addEventListener(_type: string, cb: (e: MessageEvent) => void): void {
    this.listeners.add(cb)
  }

  removeEventListener(_type: string, cb: (e: MessageEvent) => void): void {
    this.listeners.delete(cb)
  }

  terminate(): void {
    this.terminated = true
  }

  /** Simulate the worker replying 'loaded' to the last load message. */
  replyLoaded(): void {
    this.listeners.forEach((cb) =>
      cb({ data: { type: 'loaded', executionProvider: 'wasm' } } as MessageEvent),
    )
  }
}

describe('KWSEngine reload semantics', () => {
  beforeEach(() => {
    FakeWorker.instances = []
    vi.stubGlobal('Worker', FakeWorker)
    mocks.createKwsWorker.mockImplementation(() => new FakeWorker())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('load() while ready tears down the old worker and boots a fresh one', async () => {
    const engine = new KWSEngine()
    engine.setConfig({ backend: 'openwakeword' })

    // First load: a worker is created; the engine resolves once the worker
    // replies 'loaded'. Kick it off, let the dynamic-import settle, then reply.
    const load1 = engine.load({
      melspectrogram: '/mel.onnx',
      embedding: '/emb.onnx',
      classifier: '/cls.onnx',
    })
    // The worker is created inside an async dynamic-import; wait for it.
    await vi.waitFor(() => expect(FakeWorker.instances.length).toBe(1))
    await new Promise((r) => setTimeout(r, 20)) // let the listener register
    FakeWorker.instances[0].replyLoaded()
    await load1
    expect(engine.ready).toBe(true)
    expect(engine.status).toBe('ready')

    // stop(): still ready (models loaded), worker alive.
    engine.stop()
    expect(engine.status).toBe('ready')
    expect(FakeWorker.instances[0].terminated).toBe(false)

    // Reload after switching backend: the old worker must be terminated and a
    // new one created (this is the regression - previously load() returned
    // early and the stale worker kept running the old backend).
    engine.setConfig({ backend: 'plixkws' })
    const load2 = engine.load({ plixkws: '/plix.onnx' })
    await vi.waitFor(() => expect(FakeWorker.instances.length).toBe(2))
    expect(FakeWorker.instances[0].terminated).toBe(true)

    // The fresh worker received the new backend in its load message.
    const loadMsg = FakeWorker.instances[1].messages.find(
      (m) => (m as { type?: string }).type === 'load',
    ) as { backend?: string } | undefined
    expect(loadMsg?.backend).toBe('plixkws')
    FakeWorker.instances[1].replyLoaded()
    await load2
    expect(engine.status).toBe('ready')
  })

  it('concurrent load is guarded (no double worker)', async () => {
    const engine = new KWSEngine()
    engine.setConfig({ backend: 'openwakeword' })

    const p1 = engine.load({
      melspectrogram: '/mel.onnx',
      embedding: '/emb.onnx',
      classifier: '/cls.onnx',
    })
    // Second load while the first is in flight must not spawn another worker.
    const p2 = engine.load({
      melspectrogram: '/mel2.onnx',
      embedding: '/emb2.onnx',
      classifier: '/cls2.onnx',
    })
    // Only one worker should ever be created (p2 is guard-returned).
    await vi.waitFor(() => expect(FakeWorker.instances.length).toBe(1))
    // Give the engine a tick to register the message listener, then reply.
    await new Promise((r) => setTimeout(r, 20))
    FakeWorker.instances[0].replyLoaded()
    await Promise.all([p1, p2])
    expect(engine.status).toBe('ready')
  })
})
