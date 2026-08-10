/**
 * PLiX Few-Shot KWS backend (ADR-020).
 *
 * A `KWSBackend` adapter for live Few-Shot detection using the PLiX encoder
 * (aaqibsaeed/plixkws, Apache-2.0). Accumulates AFE frames into a
 * `windowMs` sliding buffer, embeds the buffer via the shared
 * `EmbedProvider` (PLiX encoder -> 1280-dim vector), computes the
 * Prototypical-Network score to the enrolled prototype, and returns the score
 * [0,1].
 *
 * PLiX replaces WavLM-base-plus as the Few-Shot encoder because its compact
 * CNN (EfficientNet-v2 "base" / TinyNet-E "small") is far lighter and was
 * designed for end-side / IoT devices, whereas WavLM-base-plus is too heavy
 * for on-device use.
 *
 * Scoring (PLiX paper §2.1.2 / §2.2): the prototype is the mean of the
 * support-set embeddings. A query's score is the negative squared Euclidean
 * distance to the prototype,
 *     s = -|| f(x) - p ||^2
 * which PLiX frames as a (softmax) classification logit. We rescale it to
 * [0,1] via   score = 1 / (1 + || f(x) - p ||^2)
 * so the existing threshold/min-duration trigger UI (tuned for [0,1]
 * posteriors, higher = trigger) works unchanged. This is the PLiX metric
 * (Euclidean / squared distance), not cosine similarity.
 *
 * Unlike `OpenWakeWordBackend`, this backend does NOT load its own models - it
 * reuses the PLiX encoder already loaded by the worker's `embedProvider`
 * (avoiding a second session). The worker constructs it with the shared
 * provider + the enrolled prototype.
 *
 * Concurrency & smoothness (the PLiX encoder is a CNN; each embed() still
 * takes longer than the 10 ms frame cadence):
 * - A continuous ring buffer always receives every frame (no gaps during
 *   inference - gaps would make the sliding window discontinuous and break
 *   detection).
 * - Inference runs only every `hopMs` (default 80 ms = 8 frames), not every
 *   frame. Between runs, the last score is returned (zero-order hold) so the
 *   score curve stays smooth and the trigger's min-duration logic sees a
 *   sustained value.
 * - A serialization guard prevents re-entrant session.run() calls.
 *
 * @see docs/modules/few-shot.md §4-§5
 * @see docs/modules/kws.md §4 (KWSBackend), §5 (Few-Shot scaffold)
 */

import type { EmbedProvider, KWSBackend } from '@wake-studio/module-kws-engine'
import type { WakeWordPrototype } from './prototype'
import { squaredEuclidean, plixScore, l2Normalize } from './prototype'
import { rmsDbfs } from '@wake-studio/dsp'

/** Detection hop in frames (80 ms / 10 ms = 8 frames at the AFE cadence). */
const HOP_FRAMES = 8

/**
 * Silence gate floor (RMS, dBFS). Windows below this energy level are scored
 * 0 without running the encoder (issue: silence/background scored 0.7+ after
 * the #66 normalization fix - the model maps silence to a spot near the
 * prototype in cosine space, producing false triggers with no speech input).
 * Speech windows sit at roughly -12 to -30 dBFS RMS; silence/noise at -45 to
 * -Infinity. Overridable per load via initWithPrototype opts
 * (silenceFloorDbfs).
 */
const DEFAULT_SILENCE_FLOOR_DBFS = -45

export class PlixKwsBackend implements KWSBackend {
  readonly id = 'plixkws' as const
  readonly label = 'PLiX Few-Shot (prototype distance)'

  private _embedProvider: EmbedProvider
  private _prototype: WakeWordPrototype
  private _windowSamples: number
  private _useNegative: boolean
  /** RMS (dBFS) below which a window is treated as silence (score 0). */
  private _silenceFloorDbfs: number

  // Continuous ring buffer (always appended to, even during inference).
  private _ring: Float32Array
  private _writeIdx = 0
  private _len = 0

  // Concurrency + caching.
  private _inferring = false
  private _lastScore = 0
  private _hasScore = false
  private _hopCounter = 0

  constructor(
    embedProvider: EmbedProvider,
    prototype: WakeWordPrototype,
    windowMs = 1500,
    useNegative = false,
    silenceFloorDbfs = DEFAULT_SILENCE_FLOOR_DBFS,
  ) {
    this._embedProvider = embedProvider
    this._prototype = prototype
    this._windowSamples = Math.round(16000 * (windowMs / 1000))
    this._useNegative = useNegative
    this._silenceFloorDbfs = silenceFloorDbfs
    // Capacity = 2x window so audio arriving during inference is never lost.
    this._ring = new Float32Array(this._windowSamples * 2)
  }

  get ready(): boolean {
    return this._embedProvider.ready
  }

  /** No-op: the PLiX encoder is loaded by the shared embedProvider. */
  async load(): Promise<void> {
    // Nothing to load - the encoder is shared.
  }

  async processFrame(samples: Float32Array): Promise<number | null> {
    if (!this.ready) return null

    // 1. Always append to the ring buffer (no gaps, even during inference).
    this._pushRing(samples)

    // 2. If inference is in flight, return the last score (zero-order hold).
    if (this._inferring) return this._hasScore ? this._lastScore : null

    // 3. Hop check: only run the encoder every HOP_FRAMES (80 ms), not every 10 ms.
    this._hopCounter++
    if (this._hopCounter < HOP_FRAMES) {
      return this._hasScore ? this._lastScore : null
    }
    this._hopCounter = 0

    // 4. Need a full window before scoring (warmup).
    if (this._len < this._windowSamples) return null

    // 5. Silence gate: a window at or below the energy floor is NOT the wake
    // word (no speech input). Score 0 and skip the encoder - the PLiX model
    // maps silence/background to a cosine-similar spot near the prototype
    // (score ~0.7+ with no input after #66), so energy gating is required to
    // avoid false positives. Speech windows sit at -12..-30 dBFS RMS.
    const window = this._latestWindow()
    const rms = rmsDbfs(window)
    if (rms < this._silenceFloorDbfs) {
      this._lastScore = 0
      this._hasScore = true
      return 0
    }

    // 6. Run the PLiX encoder on the latest window and score it.
    this._inferring = true
    try {
      const embedding = await this._embedProvider.embed(window, 16000)
      this._lastScore = this._score(embedding)
      this._hasScore = true
      return this._lastScore
    } finally {
      this._inferring = false
    }
  }

  reset(): void {
    this._writeIdx = 0
    this._len = 0
    this._inferring = false
    this._hasScore = false
    this._lastScore = 0
    this._hopCounter = 0
    this._ring.fill(0)
  }

  async dispose(): Promise<void> {
    this.reset()
    // Do not dispose the embedProvider - it is shared with the worker.
  }

  // ---- internals ----

  /** Append samples to the ring buffer, evicting oldest data when full. */
  private _pushRing(samples: Float32Array): void {
    const cap = this._ring.length
    for (let i = 0; i < samples.length; i++) {
      this._ring[this._writeIdx] = samples[i]
      this._writeIdx = (this._writeIdx + 1) % cap
    }
    this._len = Math.min(this._len + samples.length, cap)
  }

  /** Extract the latest `windowSamples` from the ring (oldest -> newest). */
  private _latestWindow(): Float32Array {
    const w = this._windowSamples
    const cap = this._ring.length
    const out = new Float32Array(w)
    // The write index points just past the newest sample; go back `w` samples.
    let read = (this._writeIdx - w + cap) % cap
    for (let i = 0; i < w; i++) {
      out[i] = this._ring[read]
      read = (read + 1) % cap
    }
    return out
  }

  /** PLiX Prototypical-Network score to the prototype (rescaled [0,1]).
   *
   * Both operands are L2-normalized first (issue #66): the encoder emits raw
   * GAP embeddings with L2 norm ~4-5, so an un-normalized squared distance is
   * large even for a near-perfect match (cosine 0.92 -> d^2 ~3-4 -> score
   * ~0.24, below any usable threshold). On unit vectors d^2 = 2(1-cos) is
   * bounded to [0,4] and the score is well-calibrated (cosine 0.92 -> ~0.86),
   * matching the cosine similarity the technical reference specifies. */
  private _score(embedding: Float32Array): number {
    const q = l2Normalize(embedding)
    const p = l2Normalize(this._prototype.vector)
    const d2 = squaredEuclidean(q, p)
    if (this._useNegative && this._prototype.negativeVector) {
      const negD2 = squaredEuclidean(q, l2Normalize(this._prototype.negativeVector))
      // Prefer the query's own class: subtract the negative-class distance.
      return plixScore(Math.max(0, d2 - negD2))
    }
    return plixScore(d2)
  }
}
