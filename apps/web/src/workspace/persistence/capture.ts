/**
 * Per-stage capture controller (epic #53 P5).
 *
 * While the pipeline runs, taps the AFE pipeline's persistent record stream
 * (raw + processed = NS output, from the worklet) and the 16 kHz KWS output
 * (onOutput) into per-stage buffers. When a capture window ends (or the user
 * stops), the buffers are ready to encode + save as clips.
 *
 * v1 scope (confirmed 2026-08-07 §11.1): raw / NS / KWS. AEC/BSS are
 * passthrough until real engines land.
 */

import type { AFEPipeline, AFEOutputFrame } from '@wake-studio/module-afe-graph'
import type { PersistStageId } from '../types'

/** A stage's max capture length in seconds (undefined = until stop). */
export interface CaptureLimits {
  raw?: number
  ns?: number
  kws?: number
}

/**
 * Ring capture for one stage: accumulates chunk slices and, when `maxLen`
 * is set, keeps only the most recent `maxLen` samples (drops the oldest).
 * Pure — unit-testable in Node without a pipeline.
 */
export class RingCapture {
  readonly stageId: PersistStageId
  readonly sampleRate: number
  /** Max samples kept; undefined = unbounded (until stop). */
  readonly maxLen: number | undefined

  private _samples: Float32Array[] = []
  private _totalLen = 0

  constructor(stageId: PersistStageId, sampleRate: number, maxLen?: number) {
    this.stageId = stageId
    this.sampleRate = sampleRate
    this.maxLen = maxLen
  }

  /** Total number of samples currently kept. */
  get length(): number {
    return this._totalLen
  }

  /** Whether any samples have been accumulated. */
  get isEmpty(): boolean {
    return this._totalLen === 0
  }

  /** Append a chunk, evicting the oldest samples past the cap. */
  push(samples: Float32Array): void {
    if (samples.length === 0) return
    if (this.maxLen != null && samples.length >= this.maxLen) {
      // A single chunk at/over the cap: keep only its tail.
      this._samples = [samples.subarray(samples.length - this.maxLen)]
      this._totalLen = this.maxLen
      return
    }
    this._samples.push(samples)
    this._totalLen += samples.length
    if (this.maxLen == null || this._totalLen <= this.maxLen) return

    // Evict oldest whole chunks; slice the head chunk if a partial eviction
    // still exceeds the cap.
    let drop = this._totalLen - this.maxLen
    while (drop > 0 && this._samples.length > 0) {
      const head = this._samples[0]
      if (head.length <= drop) {
        drop -= head.length
        this._totalLen -= head.length
        this._samples.shift()
      } else {
        this._samples[0] = head.subarray(drop)
        this._totalLen -= drop
        drop = 0
      }
    }
  }

  /** Concatenate all kept chunks into one contiguous buffer. */
  concat(): Float32Array {
    const out = new Float32Array(this._totalLen)
    let off = 0
    for (const c of this._samples) {
      out.set(c, off)
      off += c.length
    }
    return out
  }
}

/** Per-stage capture session wired to a running AFEPipeline. */
export class StageCapture {
  private _raw: RingCapture | null = null
  private _processed: RingCapture | null = null
  private _kws: RingCapture | null = null
  private _unsubs: Array<() => void> = []
  private _active = false

  /** Whether any stage is being captured. */
  get active(): boolean {
    return this._active
  }

  /** Start capturing the given stages (raw/ns/kws). No-op stages are skipped. */
  start(
    pipeline: AFEPipeline,
    stages: { raw: boolean; ns: boolean; kws: boolean },
    limits: CaptureLimits = {},
  ): void {
    if (this._active) return
    this._active = true

    // Raw + NS come from the worklet's persistent record stream (48 kHz).
    if (stages.raw || stages.ns) {
      const durationS = 3600 // effectively until stop; ring-capped by the main thread
      pipeline.recordPersistent(durationS)
      this._unsubs.push(
        pipeline.onRecordChunk((stage, samples, sampleRate) => {
          if (stages.raw && stage === 'raw') {
            if (!this._raw) {
              this._raw = new RingCapture('raw', sampleRate, secToLen(limits.raw, sampleRate))
            }
            this._raw.push(samples)
          }
          if (stages.ns && stage === 'processed') {
            if (!this._processed) {
              this._processed = new RingCapture('ns', sampleRate, secToLen(limits.ns, sampleRate))
            }
            this._processed.push(samples)
          }
        }),
      )
      this._unsubs.push(pipeline.onRecordEnd(() => {
        this._active = false
      }))
    }

    // KWS stage comes from the 16 kHz output stream (zero worklet change).
    if (stages.kws) {
      this._unsubs.push(
        pipeline.onOutput((frame: AFEOutputFrame) => {
          if (!this._kws) {
            this._kws = new RingCapture('kws', 16000, secToLen(limits.kws, 16000))
          }
          this._kws.push(frame.samples)
        }),
      )
    }
  }

  /** Stop capture; returns the buffers accumulated so far (may be empty). */
  stop(): RingCapture[] {
    for (const u of this._unsubs) u()
    this._unsubs = []
    const result: RingCapture[] = []
    if (this._raw && !this._raw.isEmpty) result.push(this._raw)
    if (this._processed && !this._processed.isEmpty) result.push(this._processed)
    if (this._kws && !this._kws.isEmpty) result.push(this._kws)
    this._raw = null
    this._processed = null
    this._kws = null
    this._active = false
    return result
  }
}

/** Convert a seconds limit to a sample-count cap (undefined = unbounded). */
function secToLen(seconds: number | undefined, sampleRate: number): number | undefined {
  if (seconds == null || seconds <= 0) return undefined
  return Math.floor(seconds * sampleRate)
}
