/**
 * File-scheduler tests (epic #53 P3).
 *
 * Node has no WebAudio API, so we stub a minimal AudioContext +
 * AudioBuffer + AudioBufferSourceNode + GainNode. Verifies: decode metadata
 * passthrough, per-channel loop/offset scheduling, concurrent addFile,
 * and dispose stops sources.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { FileScheduler } from '../sources/fileSource'
import type { DecodedFile } from '../sources/fileSource'

// ---------------------------------------------------------------------------
// Minimal WebAudio stubs.
// ---------------------------------------------------------------------------

class FakeAudioBuffer {
  length: number
  numberOfChannels: number
  sampleRate: number
  private data: Float32Array[]

  constructor(opts: { length: number; numberOfChannels: number; sampleRate: number }) {
    this.length = opts.length
    this.numberOfChannels = opts.numberOfChannels
    this.sampleRate = opts.sampleRate
    this.data = Array.from({ length: opts.numberOfChannels }, () => new Float32Array(opts.length))
  }

  getChannelData(i: number): Float32Array {
    return this.data[i]
  }

  copyToChannel(data: Float32Array, i: number): void {
    this.data[i].set(data)
  }

  get duration(): number {
    return this.length / this.sampleRate
  }
}

interface FakeSourceNode {
  buffer: FakeAudioBuffer | null
  loop: boolean
  started: Array<[number, number, number | undefined]>
  stopped: boolean
  connected: unknown[]
  stop: () => void
  start: (when: number, offset: number, dur?: number) => void
  connect: (n: unknown) => void
  disconnect: () => void
}

interface FakeGainNode {
  channelCount: number
  channelCountMode: string
  channelInterpretation: string
  connected: unknown[]
  connect: (n: unknown) => void
  disconnect: () => void
}

function makeFakeCtx() {
  const sources: FakeSourceNode[] = []
  const ctx = {
    currentTime: 10,
    createBufferSource: () => {
      const node: FakeSourceNode = {
        buffer: null,
        loop: false,
        started: [],
        stopped: false,
        connected: [],
        stop() {
          this.stopped = true
        },
        connect(n) {
          this.connected.push(n)
        },
        disconnect() {
          this.connected = []
        },
        start: (when: number, offset: number, dur?: number) => {
          node.started.push([when, offset, dur])
        },
      }
      sources.push(node)
      return node
    },
    createBuffer: (
      channels: number,
      length: number,
      sampleRate: number,
    ): FakeAudioBuffer =>
      new FakeAudioBuffer({ length, numberOfChannels: channels, sampleRate }),
    close: vi.fn(async () => {}),
    createGain: (): FakeGainNode => ({
      channelCount: 2,
      channelCountMode: 'max',
      channelInterpretation: 'speakers',
      connected: [],
      connect(n) {
        this.connected.push(n)
      },
      disconnect() {
        this.connected = []
      },
    }),
    _sources: sources,
  } as unknown as AudioContext & { _sources: FakeSourceNode[] }
  return ctx
}

function makeDecodedFile(over: Partial<DecodedFile> = {}): DecodedFile {
  const buffer = new FakeAudioBuffer({ length: 48000, numberOfChannels: 2, sampleRate: 48000 })
  return {
    id: 'f1',
    name: 'test.wav',
    buffer: buffer as unknown as AudioBuffer,
    sampleRate: 48000,
    durationMs: 1000,
    channelCount: 2,
    ...over,
  }
}

describe('FileScheduler', () => {
  let ctx: ReturnType<typeof makeFakeCtx>

  beforeEach(() => {
    ctx = makeFakeCtx()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('starts one source per configured channel, concurrently', () => {
    const s = new FileScheduler(ctx as unknown as AudioContext)
    s.addFile(makeDecodedFile(), [
      { index: 0, loop: false, offsetMs: 0 },
      { index: 1, loop: false, offsetMs: 0 },
    ])
    // Output is a 1-channel (mono) gain.
    expect(s.output.channelCount).toBe(1)
    expect(s.output.channelCountMode).toBe('explicit')
    // Two channels -> two sources.
    expect(ctx._sources).toHaveLength(2)
    expect(ctx._sources.every((src) => src.started.length === 1)).toBe(true)
    // All started at (roughly) the same time (concurrent).
    const times = ctx._sources.map((src) => src.started[0][0])
    expect(new Set(times).size).toBe(1)
    expect(s.started).toBe(true)
    s.dispose()
  })

  it('honors per-channel loop + offset', () => {
    const s = new FileScheduler(ctx as unknown as AudioContext)
    const file = makeDecodedFile()
    s.addFile(file, [
      { index: 0, loop: true, offsetMs: 500 },
      { index: 1, loop: false, offsetMs: 0 },
    ])
    const [ch0, ch1] = ctx._sources
    expect(ch0.loop).toBe(true)
    expect(ch1.loop).toBe(false)
    // Offset 500ms -> start(when, 0.5, ...)
    expect(ch0.started[0][1]).toBeCloseTo(0.5, 5)
    // Non-loop source duration arg = remaining duration.
    expect(ch1.started[0][2]).toBeCloseTo(file.buffer.duration, 5)
    s.dispose()
  })

  it('extracts a single channel for multi-channel buffers', () => {
    const s = new FileScheduler(ctx as unknown as AudioContext)
    s.addFile(makeDecodedFile(), [{ index: 1, loop: false, offsetMs: 0 }])
    const src = ctx._sources[0]
    const buf = src.buffer as unknown as FakeAudioBuffer
    // extractChannel produced a mono buffer.
    expect(buf.numberOfChannels).toBe(1)
    s.dispose()
  })

  it('dispose stops all sources and disconnects the output', () => {
    const s = new FileScheduler(ctx as unknown as AudioContext)
    s.addFile(makeDecodedFile(), [{ index: 0, loop: false, offsetMs: 0 }])
    expect(s.started).toBe(true)
    s.dispose()
    expect(ctx._sources[0].stopped).toBe(true)
    expect(ctx._sources[0].connected).toHaveLength(0)
    // The output gain node disconnects (checked through the fake ctx's gain).
    expect((s.output as unknown as FakeGainNode).connected).toHaveLength(0)
    expect(s.started).toBe(false)
  })
})
