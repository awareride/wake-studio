/**
 * kws-streaming - the pure streaming state machine.
 *
 * These helpers are the correctness core of the driver and are deliberately
 * free of onnxruntime: given a manifest they allocate the state bag, carry
 * state from one step's outputs into the next step's inputs, and turn the
 * model's multi-class output into a single wake-word posterior.
 *
 * Keeping them pure is what makes L1 tests meaningful without a model
 * artifact - and this module has no model artifact yet (upstream ships no
 * pretrained weights).
 *
 * @see docs/modules/kws-streaming.md §4.3, §5, §9
 */

import type { KwsStreamingManifest } from './manifest'
import { stateSize } from './manifest'

/** A tensor-ish value; matches onnxruntime's `Tensor` structurally. */
export interface StepTensor {
  data: Float32Array | ArrayLike<number>
}

/**
 * Allocate zero-filled state buffers for every declared state input.
 *
 * All-zeros is a cold stream: it matches upstream's `reset1` evaluation, where
 * the state is cleared before each utterance.
 */
export function createStateBag(
  manifest: KwsStreamingManifest,
): Map<string, Float32Array> {
  const bag = new Map<string, Float32Array>()
  for (const state of manifest.states) {
    bag.set(state.input, new Float32Array(stateSize(state.shape)))
  }
  return bag
}

/** Zero every buffer in place, keeping the allocation (upstream `reset1`). */
export function resetStateBag(bag: Map<string, Float32Array>): void {
  for (const buffer of bag.values()) buffer.fill(0)
}

/** Total bytes held by a state bag (surfaced in the dev panel, §8). */
export function stateBagBytes(bag: Map<string, Float32Array>): number {
  let bytes = 0
  for (const buffer of bag.values()) bytes += buffer.byteLength
  return bytes
}

/**
 * Carry state: copy each step output into its paired state input.
 *
 * This is the single operation that makes external-state streaming work. If an
 * output is missing or the wrong length the stream would keep running on stale
 * history and quietly lose accuracy, so both cases throw.
 */
export function advanceStates(
  manifest: KwsStreamingManifest,
  bag: Map<string, Float32Array>,
  outputs: Record<string, StepTensor | undefined>,
): void {
  for (const state of manifest.states) {
    const produced = outputs[state.output]
    if (!produced) {
      throw new Error(
        `kws-streaming: step produced no state output '${state.output}' ` +
          `(declared in the manifest for input '${state.input}')`,
      )
    }
    const target = bag.get(state.input)
    if (!target) {
      throw new Error(`kws-streaming: no state buffer for input '${state.input}'`)
    }
    const source = produced.data
    if (source.length !== target.length) {
      throw new Error(
        `kws-streaming: state '${state.output}' has ${source.length} elements, ` +
          `expected ${target.length} (manifest shape [${state.shape.join(', ')}])`,
      )
    }
    target.set(source as ArrayLike<number>)
  }
}

/** Numerically stable softmax over a copy of `logits`. */
export function softmax(logits: ArrayLike<number>): Float32Array {
  const out = new Float32Array(logits.length)
  let max = -Infinity
  for (let i = 0; i < logits.length; i++) {
    if (logits[i] > max) max = logits[i]
  }
  let sum = 0
  for (let i = 0; i < logits.length; i++) {
    const e = Math.exp(logits[i] - max)
    out[i] = e
    sum += e
  }
  if (sum > 0) {
    for (let i = 0; i < out.length; i++) out[i] /= sum
  }
  return out
}

/**
 * Read the wanted word's posterior out of the model's multi-class output.
 *
 * Upstream models are multi-class (e.g. Speech Commands 12 labels); WakeStudio
 * needs a single [0,1] score for the engine's threshold logic, so we select one
 * column - softmaxing first when the graph did not.
 */
export function selectLabelScore(
  manifest: KwsStreamingManifest,
  logits: ArrayLike<number>,
  wantedWord: string = manifest.wantedWord,
): number {
  const index = manifest.labels.indexOf(wantedWord)
  if (index < 0) {
    throw new Error(
      `kws-streaming: label '${wantedWord}' is not one of [${manifest.labels.join(', ')}]`,
    )
  }
  if (logits.length < manifest.labels.length) {
    throw new Error(
      `kws-streaming: output has ${logits.length} values but the manifest ` +
        `declares ${manifest.labels.length} labels`,
    )
  }
  const probs = manifest.softmaxed ? logits : softmax(logits)
  const score = probs[index]
  if (!Number.isFinite(score)) return 0
  return Math.max(0, Math.min(1, score))
}

/**
 * Packet aligner: buffers 10 ms AFE frames and yields whole model packets.
 *
 * Upstream is explicit that the streaming input length must be aligned with the
 * model's total stride/pooling, so a partial packet is never emitted.
 */
export class PacketBuffer {
  private _buffer: Float32Array
  private _length = 0

  constructor(readonly packetSamples: number) {
    if (!Number.isInteger(packetSamples) || packetSamples <= 0) {
      throw new Error(`kws-streaming: invalid packetSamples ${packetSamples}`)
    }
    // Room for one packet plus a generous frame's worth of spill.
    this._buffer = new Float32Array(packetSamples * 2)
  }

  /** Samples currently buffered but not yet consumed. */
  get length(): number {
    return this._length
  }

  /** Append samples, growing the backing store if a large frame arrives. */
  push(samples: Float32Array): void {
    if (this._length + samples.length > this._buffer.length) {
      const grown = new Float32Array(
        Math.max(this._buffer.length * 2, this._length + samples.length),
      )
      grown.set(this._buffer.subarray(0, this._length))
      this._buffer = grown
    }
    this._buffer.set(samples, this._length)
    this._length += samples.length
  }

  /**
   * Take one whole packet, or null when not enough audio is buffered.
   * The returned array is a copy, so callers may hand it to a tensor safely.
   */
  take(): Float32Array | null {
    if (this._length < this.packetSamples) return null
    const packet = this._buffer.slice(0, this.packetSamples)
    this._buffer.copyWithin(0, this.packetSamples, this._length)
    this._length -= this.packetSamples
    return packet
  }

  clear(): void {
    this._length = 0
    this._buffer.fill(0)
  }
}
