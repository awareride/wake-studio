/**
 * kws-sherpa driver - backend decode-loop regression tests (issue #64).
 *
 * Guards the streaming decode contract: the stream must NOT be reset after
 * every decode (that wiped the encoder RNN state and made multi-frame
 * keywords like 你好军哥 never fire). Reset is only legal after a keyword hit,
 * mirroring the upstream wasm/kws/app.js demo; sherpa auto-resets on trailing
 * silence internally.
 *
 * These tests run without the wasm (L2 is gated, issue #49) - they inject a
 * fake spotter/stream into the backend and drive processFrame directly.
 */

import { describe, it, expect, vi } from 'vitest'
import { SherpaOnnxKwsBackend } from '../core/backend'

interface FakeStream {
  acceptWaveform: ReturnType<typeof vi.fn>
  free: ReturnType<typeof vi.fn>
}

/** Minimal fake spotter mirroring the SherpaKws surface used by processFrame. */
class FakeSpotter {
  /** isReady() returns true this many times before turning false. */
  readyTicks = 0
  decodeCalls = 0
  resetCalls = 0
  results: Array<{ keyword?: string }> = []

  createStream(): FakeStream {
    return {
      acceptWaveform: vi.fn(),
      free: vi.fn(),
    }
  }

  isReady(): boolean {
    return this.readyTicks-- > 0
  }

  decode(): void {
    this.decodeCalls += 1
  }

  getResult(): { keyword?: string } {
    return this.results.shift() ?? { keyword: '' }
  }

  reset(): void {
    this.resetCalls += 1
  }

  free(): void {}
}

function makeBackend(spotter: FakeSpotter): TestBackend {
  const backend = new SherpaOnnxKwsBackend() as unknown as TestBackend
  backend._ready = true
  backend._spotter = spotter
  backend._stream = spotter.createStream()
  return backend
}

/** Structural view of the backend internals used by the tests (private
 *  members are compile-time-only; cast via unknown avoids the never trap). */
interface TestBackend {
  _ready: boolean
  _spotter: FakeSpotter
  _stream: FakeStream
  _holdFrames: number
  lastPartialText: string
  processFrame(samples: Float32Array): Promise<number | null>
}

const FRAME = new Float32Array(160) // 10 ms @ 16 kHz

describe('SherpaOnnxKwsBackend.processFrame', () => {
  it('does NOT reset the stream when no keyword is detected', async () => {
    const spotter = new FakeSpotter()
    spotter.readyTicks = 1
    spotter.results = [{ keyword: '' }]
    const backend = makeBackend(spotter)

    const score = await backend.processFrame(FRAME)

    expect(score).toBe(0)
    expect(spotter.decodeCalls).toBe(1)
    // The bug (issue #64): resetting here wiped the encoder RNN states, so
    // keywords spanning multiple chunks never accumulated. Reset is only legal
    // after a keyword hit.
    expect(spotter.resetCalls).toBe(0)
  })

  it('decodes every ready chunk before giving up', async () => {
    const spotter = new FakeSpotter()
    spotter.readyTicks = 3
    spotter.results = [{ keyword: '' }, { keyword: '' }, { keyword: '' }]
    const backend = makeBackend(spotter)

    const score = await backend.processFrame(FRAME)

    expect(score).toBe(0)
    expect(spotter.decodeCalls).toBe(3)
    expect(spotter.resetCalls).toBe(0)
  })

  it('returns 1 and resets exactly once after a keyword hit', async () => {
    const spotter = new FakeSpotter()
    spotter.readyTicks = 2
    spotter.results = [{ keyword: '' }, { keyword: '你好军哥' }]
    const backend = makeBackend(spotter)

    const score = await backend.processFrame(FRAME)

    expect(score).toBe(1)
    expect(backend.lastPartialText).toBe('你好军哥')
    expect(spotter.resetCalls).toBe(1)
    // The detected keyword's score is held for the trigger min-duration gate.
    const next = await backend.processFrame(FRAME)
    expect(next).toBe(1)
  })

  it('accepts waveform every frame even while holding a hit', async () => {
    const spotter = new FakeSpotter()
    spotter.readyTicks = 1
    spotter.results = [{ keyword: '小爱同学' }]
    const backend = makeBackend(spotter)

    await backend.processFrame(FRAME)
    const stream = backend._stream
    expect(stream.acceptWaveform).toHaveBeenCalledTimes(1)

    // Hold period: still accepts audio, does not decode.
    const held = await backend.processFrame(FRAME)
    expect(held).toBe(1)
    expect(stream.acceptWaveform).toHaveBeenCalledTimes(2)
    expect(spotter.decodeCalls).toBe(1)
  })
})
