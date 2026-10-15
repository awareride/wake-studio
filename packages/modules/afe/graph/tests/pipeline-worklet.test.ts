/**
 * AFE graph - worklet geometry dispatch (issue #245, browser half).
 *
 * The graph core's geometry rules are covered in tests/geometry.test.ts; this
 * file drives the actual AudioWorkletProcessor so the wiring is exercised too:
 * what the worklet does with the channels that really arrived, when it serves
 * them to a stage, and when it refuses.
 *
 * The processor is instantiated directly with stage overrides, because no
 * shipped stage declares an array yet (AEC/BSS are passthrough and RNNoise is
 * mono, ADR-016) - a fake 2-channel stage is what makes the spatial path
 * real. Web Audio globals are stubbed, as the worklet expects to run inside
 * an AudioWorkletGlobalScope.
 */

import { describe, it, expect, vi } from 'vitest'
import type { AFEStage, AFEStageGeometry, AFEStageParams, AFEStageResult } from '@wake-studio/contracts'

// ---------------------------------------------------------------------------
// AudioWorkletGlobalScope stubs, installed before the worklet module loads.
// ---------------------------------------------------------------------------

class FakePort {
  posted: unknown[] = []
  onmessage: ((e: { data: unknown }) => void) | null = null
  postMessage(msg: unknown): void {
    this.posted.push(msg)
  }
}

class FakeAudioWorkletProcessor {
  port = new FakePort()
}

let registered: unknown = null

vi.stubGlobal('AudioWorkletProcessor', FakeAudioWorkletProcessor)
vi.stubGlobal('registerProcessor', (_name: string, ctor: unknown) => {
  registered = ctor
})
vi.stubGlobal('sampleRate', 48000)
vi.stubGlobal('currentTime', 0)

/** A stage that declares a real array, so the planar path has something to run. */
class ArrayStage implements AFEStage {
  readonly kind = 'bss' as const
  readonly geometry: AFEStageGeometry = {
    inputChannels: 2,
    outputChannels: 2,
    referenceChannels: 0,
  }
  calls: Array<{ channels: number[]; reference: number }> = []

  process(_frame: Float32Array): AFEStageResult {
    throw new Error('mono process() must not be called for a 2-channel stage')
  }

  processFrame(channels: Float32Array[], reference: Float32Array[] | null): AFEStageResult {
    this.calls.push({
      channels: channels.map((c) => c[0]),
      reference: reference ? reference.length : 0,
    })
    for (const plane of channels) plane.fill(0.25)
    return { vadProbability: 0, levelDb: -6 }
  }

  reset(): void {}
  configure(_params: AFEStageParams): void {}
}

/** A mono stage that records the planes it was fed. */
class MonoStage implements AFEStage {
  readonly kind = 'ns' as const
  readonly geometry: AFEStageGeometry = { inputChannels: 1, outputChannels: 1, referenceChannels: 0 }
  frames: Float32Array[] = []
  process(frame: Float32Array): AFEStageResult {
    this.frames.push(frame.slice())
    return { vadProbability: 0.5, levelDb: -6 }
  }
  reset(): void {}
}

/** The surface of the processor the test drives (port + process callback). */
interface Processor {
  port: FakePort
  process: (inputs: Float32Array[][], outputs: Float32Array[][]) => boolean
}

type ProcessorCtor = new (options?: unknown) => Processor

/** The processor class the worklet module registered at import time. */
let Ctor: ProcessorCtor | null = null

async function loadProcessor(): Promise<ProcessorCtor> {
  if (Ctor) return Ctor
  await import('../web/pipeline-processor.worklet')
  Ctor = registered as ProcessorCtor
  return Ctor
}

/** Feed `quantum` quanta of `micChannels` planes; returns the processor. */
function feed(
  p: Processor,
  micChannels: number,
  quanta: number,
  fill: (c: number, i: number) => number = (c, i) => (c === 0 ? Math.sin(i) : Math.cos(i)),
): void {
  for (let q = 0; q < quanta; q++) {
    const inputs: Float32Array[][] = [
      Array.from({ length: micChannels }, (_, c) =>
        Float32Array.from({ length: 128 }, (_, i) => fill(c, i)),
      ),
      [],
    ]
    const outputs: Float32Array[][] = [[new Float32Array(128)]]
    p.process(inputs, outputs)
  }
}

function postedOfType<T>(p: Processor, type: string): T[] {
  return p.port.posted.filter((m) => (m as { type: string }).type === type) as T[]
}

describe('pipeline-processor geometry dispatch (#245)', () => {
  it('registers the processor class under the pipeline name', async () => {
    await loadProcessor()
    expect(typeof registered).toBe('function')
  })

  it('serves a mono capture to a mono stage as before (default path)', async () => {
    const Ctor = await loadProcessor()
    const ns = new MonoStage()
    const p = new Ctor({ ns })
    feed(p, 1, 4) // 512 samples = one 480-sample frame + change
    expect(ns.frames.length).toBeGreaterThan(0)
    expect(ns.frames[0].length).toBe(480)
  })

  it('downmixes a multi-channel capture for a mono-declared stage', async () => {
    const Ctor = await loadProcessor()
    const ns = new MonoStage()
    const p = new Ctor({ ns })
    p.port.onmessage!({
      data: { type: 'config', bypass: { aec: true, bss: true, ns: false }, vizFps: 30, channels: 2, spatialSupported: true },
    })
    feed(p, 2, 8)
    expect(ns.frames.length).toBeGreaterThan(0)
    // Channel 0 = sin(i), channel 1 = cos(i): a graph-owned average, exactly
    // what the device graph feeds a stage that declared fewer channels.
    const f = ns.frames[0]
    const expected = (Math.sin(0) + Math.cos(0)) / 2
    expect(f[0]).toBeCloseTo(expected, 5)
  })

  it('feeds the real channel planes to a stage that declares an array', async () => {
    const Ctor = await loadProcessor()
    const bss = new ArrayStage()
    const p = new Ctor({ bss })
    p.port.onmessage!({
      data: { type: 'config', bypass: { aec: true, bss: false, ns: true }, vizFps: 30, channels: 2, spatialSupported: true },
    })
    feed(p, 2, 8)
    expect(bss.calls.length).toBeGreaterThan(0)
    // Both planes arrived, as planar views the stage can read.
    expect(bss.calls[0].channels[0]).toBeCloseTo(Math.sin(0), 5)
    expect(bss.calls[0].channels[1]).toBeCloseTo(Math.cos(0), 5)
  })

  it('refuses a spatial stage while the capture is unqualified (#246)', async () => {
    const Ctor = await loadProcessor()
    const bss = new ArrayStage()
    const p = new Ctor({ bss })
    // Declared 2 channels, but no qualified capture: the graph serves mono, and
    // the spatial stage is refused instead of fed one channel.
    p.port.onmessage!({
      data: { type: 'config', bypass: { aec: true, bss: false, ns: true }, vizFps: 30, channels: 2, spatialSupported: false },
    })
    feed(p, 2, 8)
    expect(bss.calls).toHaveLength(0)
    const errors = postedOfType<{ message: string }>(p, 'error')
    expect(errors.some((e) => /needs 2 mic channel/.test(e.message))).toBe(true)
  })

  it('serves a stage that declares a far-end reference only when one exists', async () => {
    const Ctor = await loadProcessor()
    // A reference-declaring stage, delivered via the AEC slot.
    class RefStage implements AFEStage {
      readonly kind = 'aec' as const
      readonly geometry: AFEStageGeometry = {
        inputChannels: 1,
        outputChannels: 1,
        referenceChannels: 1,
      }
      seen: Array<number[]> = []
      process(_frame: Float32Array): AFEStageResult {
        return { vadProbability: 0, levelDb: -6 }
      }
      processFrame(channels: Float32Array[], reference: Float32Array[] | null): AFEStageResult {
        this.seen.push([channels[0][0], reference ? reference[0][0] : Number.NaN])
        return { vadProbability: 0, levelDb: -6 }
      }
      reset(): void {}
    }
    const aec = new RefStage()
    const p = new Ctor({ aec })
    // Reference declared but no reference input wired in: refused, once.
    p.port.onmessage!({
      data: { type: 'config', bypass: { aec: false, bss: true, ns: true }, vizFps: 30, referenceChannels: 1 },
    })
    feed(p, 1, 4)
    expect(aec.seen).toHaveLength(0)
    expect(
      postedOfType<{ message: string }>(p, 'error').some((e) => /far-end reference/.test(e.message)),
    ).toBe(true)
  })

  it('passes the reference plane through to the stage that declared one', async () => {
    const Ctor = await loadProcessor()
    const seen: number[][] = []
    class RefStage implements AFEStage {
      readonly kind = 'aec' as const
      readonly geometry: AFEStageGeometry = {
        inputChannels: 1,
        outputChannels: 1,
        referenceChannels: 1,
      }
      process(_frame: Float32Array): AFEStageResult {
        return { vadProbability: 0, levelDb: -6 }
      }
      processFrame(channels: Float32Array[], reference: Float32Array[] | null): AFEStageResult {
        seen.push([channels[0][0], reference![0][0]])
        return { vadProbability: 0, levelDb: -6 }
      }
      reset(): void {}
    }
    const p = new Ctor({ aec: new RefStage() })
    p.port.onmessage!({
      data: {
        type: 'config',
        bypass: { aec: false, bss: true, ns: true },
        vizFps: 30,
        referenceChannels: 1,
      },
    })
    for (let q = 0; q < 8; q++) {
      p.process([[new Float32Array(128).fill(0.5)], [new Float32Array(128).fill(-0.25)]], [
        [new Float32Array(128)],
      ])
    }
    expect(seen.length).toBeGreaterThan(0)
    expect(seen[0][0]).toBeCloseTo(0.5, 5)
    expect(seen[0][1]).toBeCloseTo(-0.25, 5)
  })
})
