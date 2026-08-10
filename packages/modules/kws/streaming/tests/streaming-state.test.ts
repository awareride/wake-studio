/**
 * kws-streaming driver module - L1 tests (ADR-026).
 *
 * The streaming state machine is the correctness core of this driver: with
 * external-state graphs, a mis-carried buffer does not error, it silently
 * degrades accuracy. These tests exercise the carry, the packet alignment and
 * the label selection against a FAKE step, so they need no model artifact
 * (upstream ships no pretrained weights).
 *
 * @see docs/modules/kws-streaming.md §9
 */

import { describe, it, expect } from 'vitest'
import {
  KwsStreamingManifestError,
  STREAMABLE_MODELS,
  stateSize,
  validateManifest,
  type KwsStreamingManifest,
} from '../core/manifest'
import {
  PacketBuffer,
  advanceStates,
  createStateBag,
  resetStateBag,
  selectLabelScore,
  softmax,
  stateBagBytes,
} from '../core/streaming'

/** A minimal well-formed manifest (ds_tc_resnet-shaped). */
function baseManifest(): Record<string, unknown> {
  return {
    version: 1,
    model: 'ds_tc_resnet',
    upstreamRef: 'master',
    labels: ['silence', 'unknown', 'up', 'down'],
    wantedWord: 'up',
    sampleRate: 16000,
    packetSamples: 320,
    featureExtractor: 'graph',
    audioInput: 'input_audio',
    scoreOutput: 'output_logits',
    softmaxed: true,
    states: [
      { input: 'state_in_0', output: 'state_out_0', shape: [1, 3, 4] },
      { input: 'state_in_1', output: 'state_out_1', shape: [1, 2] },
    ],
  }
}

const manifest = (): KwsStreamingManifest => validateManifest(baseManifest())

describe('validateManifest', () => {
  it('accepts a well-formed manifest', () => {
    const m = manifest()
    expect(m.model).toBe('ds_tc_resnet')
    expect(m.packetSamples).toBe(320)
    expect(m.states).toHaveLength(2)
  })

  it('defaults upstreamRef when absent (informational field only)', () => {
    const raw = baseManifest()
    delete raw.upstreamRef
    expect(validateManifest(raw).upstreamRef).toBe('unknown')
  })

  it('rejects an unsupported schema version', () => {
    expect(() => validateManifest({ ...baseManifest(), version: 2 })).toThrow(
      KwsStreamingManifestError,
    )
  })

  it('rejects non-streamable topologies (upstream cannot convert them)', () => {
    // att_mh_rnn is accurate (98.4%) but attends over the whole sequence, so
    // upstream marks it non-streamable - no manifest can legitimately exist.
    for (const model of ['att_rnn', 'att_mh_rnn', 'tc_resnet', 'mobilenet', 'xception']) {
      expect(() => validateManifest({ ...baseManifest(), model })).toThrow(
        /non-streamable/,
      )
    }
    for (const model of STREAMABLE_MODELS) {
      expect(() => validateManifest({ ...baseManifest(), model })).not.toThrow()
    }
  })

  it('rejects a wantedWord that is not a label', () => {
    expect(() =>
      validateManifest({ ...baseManifest(), wantedWord: 'left' }),
    ).toThrow(/not one of the labels/)
  })

  it("rejects featureExtractor 'external' (Q-KS-2, not supported yet)", () => {
    expect(() =>
      validateManifest({ ...baseManifest(), featureExtractor: 'external' }),
    ).toThrow(/preprocess raw/)
  })

  it('rejects a non-integer or non-positive packetSamples', () => {
    expect(() => validateManifest({ ...baseManifest(), packetSamples: 0 })).toThrow()
    expect(() => validateManifest({ ...baseManifest(), packetSamples: 320.5 })).toThrow()
  })

  it('rejects duplicate state names (aliased buffers mix unrelated history)', () => {
    const dupIn = baseManifest()
    dupIn.states = [
      { input: 's', output: 'a', shape: [1] },
      { input: 's', output: 'b', shape: [1] },
    ]
    expect(() => validateManifest(dupIn)).toThrow(/duplicate state input/)

    const dupOut = baseManifest()
    dupOut.states = [
      { input: 'a', output: 's', shape: [1] },
      { input: 'b', output: 's', shape: [1] },
    ]
    expect(() => validateManifest(dupOut)).toThrow(/duplicate state output/)
  })

  it('rejects an audioInput/scoreOutput that collides with a state', () => {
    expect(() =>
      validateManifest({ ...baseManifest(), audioInput: 'state_in_0' }),
    ).toThrow(/also declared as a state input/)
    expect(() =>
      validateManifest({ ...baseManifest(), scoreOutput: 'state_out_1' }),
    ).toThrow(/also declared as a state output/)
  })

  it('rejects malformed state shapes', () => {
    const raw = baseManifest()
    raw.states = [{ input: 'a', output: 'b', shape: [1, 0] }]
    expect(() => validateManifest(raw)).toThrow(/positive integers/)
  })
})

describe('state bag', () => {
  it('allocates one zero-filled buffer per declared state', () => {
    const m = manifest()
    const bag = createStateBag(m)
    expect([...bag.keys()]).toEqual(['state_in_0', 'state_in_1'])
    expect(bag.get('state_in_0')!.length).toBe(12) // 1*3*4
    expect(bag.get('state_in_1')!.length).toBe(2)
    expect([...bag.values()].every((b) => b.every((v) => v === 0))).toBe(true)
    // 14 floats * 4 bytes
    expect(stateBagBytes(bag)).toBe(56)
  })

  it('stateSize multiplies the shape', () => {
    expect(stateSize([1, 3, 4])).toBe(12)
    expect(stateSize([5])).toBe(5)
  })

  it('resets in place, keeping the allocation (upstream reset1)', () => {
    const bag = createStateBag(manifest())
    const buffer = bag.get('state_in_1')!
    buffer.set([0.5, -0.25])
    resetStateBag(bag)
    expect(bag.get('state_in_1')).toBe(buffer) // same allocation
    expect([...buffer]).toEqual([0, 0])
  })
})

describe('advanceStates (the state carry)', () => {
  it("copies each step's state output into its paired input", () => {
    const m = manifest()
    const bag = createStateBag(m)
    advanceStates(m, bag, {
      state_out_0: { data: new Float32Array(12).fill(7) },
      state_out_1: { data: new Float32Array([1, 2]) },
    })
    expect([...bag.get('state_in_0')!]).toEqual(new Array(12).fill(7))
    expect([...bag.get('state_in_1')!]).toEqual([1, 2])
  })

  it('carries across successive steps without aliasing the tensors', () => {
    const m = manifest()
    const bag = createStateBag(m)
    const produced = new Float32Array([1, 2])
    advanceStates(m, bag, {
      state_out_0: { data: new Float32Array(12) },
      state_out_1: { data: produced },
    })
    // Mutating the step's tensor must not reach into the carried state.
    produced.set([9, 9])
    expect([...bag.get('state_in_1')!]).toEqual([1, 2])
  })

  it('throws when a declared state output is missing', () => {
    const m = manifest()
    expect(() =>
      advanceStates(m, createStateBag(m), {
        state_out_0: { data: new Float32Array(12) },
      }),
    ).toThrow(/no state output 'state_out_1'/)
  })

  it('throws when a state output has the wrong length', () => {
    const m = manifest()
    expect(() =>
      advanceStates(m, createStateBag(m), {
        state_out_0: { data: new Float32Array(12) },
        state_out_1: { data: new Float32Array(3) },
      }),
    ).toThrow(/expected 2/)
  })
})

describe('selectLabelScore', () => {
  it('reads the wanted label column from an already-softmaxed output', () => {
    const m = manifest()
    const score = selectLabelScore(m, new Float32Array([0.1, 0.2, 0.6, 0.1]))
    expect(score).toBeCloseTo(0.6, 6)
  })

  it('softmaxes first when the graph did not', () => {
    const m = validateManifest({ ...baseManifest(), softmaxed: false })
    const logits = new Float32Array([0, 0, 10, 0])
    const score = selectLabelScore(m, logits)
    expect(score).toBeGreaterThan(0.99)
    // ...and the non-wanted columns stay small.
    expect(selectLabelScore(m, logits, 'down')).toBeLessThan(0.01)
  })

  it('honours an overridden wanted word', () => {
    const m = manifest()
    expect(selectLabelScore(m, new Float32Array([0.1, 0.2, 0.6, 0.1]), 'down')).toBeCloseTo(
      0.1,
      6,
    )
  })

  it('throws on an unknown label', () => {
    expect(() =>
      selectLabelScore(manifest(), new Float32Array(4), 'left'),
    ).toThrow(/not one of/)
  })

  it('throws when the output has fewer columns than declared labels', () => {
    expect(() => selectLabelScore(manifest(), new Float32Array(2))).toThrow(
      /declares 4 labels/,
    )
  })

  it('clamps and sanitizes non-finite values', () => {
    const m = manifest()
    expect(selectLabelScore(m, new Float32Array([0, 0, 1.5, 0]))).toBe(1)
    expect(selectLabelScore(m, new Float32Array([0, 0, -0.2, 0]))).toBe(0)
    expect(selectLabelScore(m, new Float32Array([0, 0, NaN, 0]))).toBe(0)
  })
})

describe('softmax', () => {
  it('sums to 1 and is stable for large logits', () => {
    const p = softmax([1000, 1000, 1001])
    const sum = [...p].reduce((a, b) => a + b, 0)
    expect(sum).toBeCloseTo(1, 6)
    expect(p.every(Number.isFinite)).toBe(true)
    expect(p[2]).toBeGreaterThan(p[0])
  })
})

describe('PacketBuffer (packet alignment)', () => {
  it('never yields a partial packet', () => {
    const buffer = new PacketBuffer(320)
    buffer.push(new Float32Array(160)) // one 10 ms AFE frame
    expect(buffer.take()).toBeNull()
    buffer.push(new Float32Array(160))
    expect(buffer.take()?.length).toBe(320)
    expect(buffer.take()).toBeNull()
  })

  it('preserves sample order and keeps the remainder', () => {
    const buffer = new PacketBuffer(4)
    buffer.push(new Float32Array([1, 2, 3, 4, 5, 6]))
    expect([...buffer.take()!]).toEqual([1, 2, 3, 4])
    expect(buffer.length).toBe(2)
    buffer.push(new Float32Array([7, 8]))
    expect([...buffer.take()!]).toEqual([5, 6, 7, 8])
  })

  it('yields multiple packets from one large frame', () => {
    const buffer = new PacketBuffer(2)
    buffer.push(new Float32Array([1, 2, 3, 4, 5]))
    const packets: number[][] = []
    for (let p = buffer.take(); p !== null; p = buffer.take()) packets.push([...p])
    expect(packets).toEqual([
      [1, 2],
      [3, 4],
    ])
    expect(buffer.length).toBe(1)
  })

  it('grows for frames larger than its initial capacity', () => {
    const buffer = new PacketBuffer(4)
    buffer.push(new Float32Array(100).fill(3))
    expect(buffer.length).toBe(100)
    expect([...buffer.take()!]).toEqual([3, 3, 3, 3])
  })

  it('clear() drops buffered audio', () => {
    const buffer = new PacketBuffer(4)
    buffer.push(new Float32Array([1, 2, 3]))
    buffer.clear()
    expect(buffer.length).toBe(0)
    expect(buffer.take()).toBeNull()
  })

  it('rejects an invalid packet size', () => {
    expect(() => new PacketBuffer(0)).toThrow()
    expect(() => new PacketBuffer(1.5)).toThrow()
  })
})
