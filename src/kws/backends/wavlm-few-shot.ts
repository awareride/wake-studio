/**
 * WavLM Few-Shot KWS backend (ADR-020).
 *
 * A `KWSBackend` adapter for live Few-Shot detection: accumulates AFE frames
 * into a `windowMs` sliding buffer, embeds the buffer via the shared
 * `EmbedProvider` (WavLM), computes cosine similarity to the enrolled
 * prototype, and returns the score [0,1].
 *
 * Unlike `OpenWakeWordBackend`, this backend does NOT load its own models - it
 * reuses the WavLM encoder already loaded by the worker's `embedProvider`
 * (avoiding a second 95 MB session). The worker constructs it with the shared
 * provider + the enrolled prototype.
 *
 * @see docs/modules/few-shot.md §4-§5
 */

import type { EmbedProvider, KWSBackend } from '../types'
import type { WakeWordPrototype } from '../../few-shot/types'
import { cosineSimilarity } from '../../few-shot/dsp'

export class WavLMFewShotBackend implements KWSBackend {
  readonly id = 'wavlm-few-shot' as const
  readonly label = 'WavLM Few-Shot (cosine prototype)'

  private _embedProvider: EmbedProvider
  private _prototype: WakeWordPrototype
  private _windowSamples: number
  private _useNegative: boolean

  // Sliding audio buffer.
  private _audioBuffer: Float32Array
  private _bufferFill = 0

  constructor(
    embedProvider: EmbedProvider,
    prototype: WakeWordPrototype,
    windowMs = 1500,
    useNegative = false,
  ) {
    this._embedProvider = embedProvider
    this._prototype = prototype
    this._windowSamples = Math.round(16000 * (windowMs / 1000))
    this._useNegative = useNegative
    this._audioBuffer = new Float32Array(this._windowSamples)
  }

  get ready(): boolean {
    return this._embedProvider.ready
  }

  /** No-op: the WavLM encoder is loaded by the shared embedProvider. */
  async load(): Promise<void> {
    // Nothing to load - the encoder is shared.
  }

  async processFrame(samples: Float32Array): Promise<number | null> {
    if (!this.ready) return null

    // Append samples to the sliding buffer.
    for (let i = 0; i < samples.length; i++) {
      this._audioBuffer[this._bufferFill++] = samples[i]
      if (this._bufferFill >= this._windowSamples) {
        // Embed the window and compute cosine similarity.
        const score = await this._scoreWindow()
        // Shift by the hop (reuse the last hopMs of audio; for simplicity shift
        // by the frame size, which is fine for 10 ms frames at a 1500 ms window).
        this._audioBuffer.copyWithin(0, samples.length, this._windowSamples)
        this._bufferFill = this._windowSamples - samples.length
        return score
      }
    }
    return null // warmup (window not full yet)
  }

  reset(): void {
    this._bufferFill = 0
    this._audioBuffer.fill(0)
  }

  async dispose(): Promise<void> {
    this.reset()
    // Do not dispose the embedProvider - it is shared with the worker.
  }

  private async _scoreWindow(): Promise<number> {
    // Embed the current audio window.
    const window = this._audioBuffer.slice(0, this._bufferFill || this._windowSamples)
    const embedding = await this._embedProvider.embed(window, 16000)

    // Cosine similarity to the prototype (rescaled [0,1]).
    let score = cosineSimilarity(embedding, this._prototype.vector)

    // Optional negative prototype: subtract its similarity (tighter boundary).
    if (this._useNegative && this._prototype.negativeVector) {
      const negScore = cosineSimilarity(embedding, this._prototype.negativeVector)
      score = Math.max(0, score - negScore)
    }

    return score
  }
}
