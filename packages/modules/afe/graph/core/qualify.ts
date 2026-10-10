/**
 * AFE module - capture / array qualification (issue #246).
 *
 * A stereo-looking stream is **not** evidence that two independent microphones
 * reached the processing callback. A `MediaStreamTrack` can report 2 channels
 * while the OS has already downmixed to mono, duplicated one channel, or
 * reordered them. Any of those silently destroys spatial processing: a
 * delay-and-sum beamformer fed a duplicated channel collapses back to a
 * pass-through, and the UI would be implying a 2-mic array that does not exist.
 *
 * This module decides whether spatial processing may be enabled at all. It is
 * deliberately independent of any spatial implementation — today AEC/BSS are
 * passthrough (ADR-016), and #245 will consume this verdict when the
 * configuration-driven geometry lands.
 *
 * What this CAN detect: channel count actually delivered, identical/duplicated
 * channels (the signature of an OS downmix), gross energy imbalance, and
 * clipping. What it CANNOT prove on its own: that two channels are physically
 * distinct microphones. That needs a calibrated capture or a listening test, so
 * a `qualified` verdict means "no disqualifying signature found", not "verified
 * hardware".
 */

/** Tri-state verdict; only `qualified` permits spatial processing. */
export type QualificationLevel = 'qualified' | 'degraded' | 'unsupported'

/** What the worklet observed over the observation window. */
export interface CaptureReport {
  /** Channels requested when the capture was opened (track settings). */
  requestedChannels: number
  /** Channels actually delivered to the callback (`inputs[0].length`). */
  observedChannels: number
  /** Context sample rate the capture delivered. */
  sampleRate: number
  /** Frames observed; too few means the evidence is weak, not passing. */
  framesObserved: number
  /**
   * Peak normalised zero-lag correlation between channel pairs over the window.
   * 1 means identical signals (duplicated or downmixed); near 0 means
   * independent content.
   */
  maxPairCorrelation: number
  /** True when any observed sample hit full scale. */
  clipped: boolean
  /**
   * min/max total energy across channels over the window, in [0,1]. Near 0
   * means one channel is effectively dead or muted.
   */
  energyRatio: number
}

export interface QualificationResult {
  level: QualificationLevel
  /** Whether a spatial stage may be enabled. */
  spatialSupported: boolean
  /** Human-readable reasons, suitable for direct display. */
  reasons: string[]
}

/** Minimum frames before a verdict is allowed to be `qualified`. */
export const MIN_OBSERVATION_FRAMES = 10

/** Correlation at or above this counts as "the same signal on both channels". */
export const DUPLICATE_CORRELATION = 0.999

/** Energy ratio (quieter/louder) beyond this suggests a dead channel. */
export const ENERGY_IMBALANCE_RATIO = 0.05

/**
 * Decide whether spatial processing may be enabled.
 *
 * Fails safe: anything not provably independent stays unsupported, and the
 * pipeline must degrade to mono passthrough rather than proceed.
 */
export function evaluateQualification(report: CaptureReport): QualificationResult {
  const reasons: string[] = []
  const { observedChannels, requestedChannels, framesObserved, maxPairCorrelation } = report

  // --- Channel count: the decisive check -------------------------------
  if (observedChannels < 2) {
    reasons.push(
      observedChannels === 0
        ? 'No audio channels were delivered to the processor.'
        : `Capture delivered ${observedChannels} channel(s); spatial processing needs 2 or more.`,
    )
    if (requestedChannels >= 2 && observedChannels < requestedChannels) {
      reasons.push(
        `Requested ${requestedChannels} channels but only ${observedChannels} arrived — the OS or browser likely downmixed.`,
      )
    }
    return { level: 'unsupported', spatialSupported: false, reasons }
  }

  if (requestedChannels < observedChannels) {
    reasons.push(
      `Delivered ${observedChannels} channels although only ${requestedChannels} were requested.`,
    )
  }

  // --- Independence: the disqualifying signature of an OS downmix -------
  if (maxPairCorrelation >= DUPLICATE_CORRELATION) {
    reasons.push(
      'Channels carry the same signal (correlation ' +
        maxPairCorrelation.toFixed(4) +
        ') — the capture is duplicated or downmixed, so there is no array.',
    )
    return { level: 'unsupported', spatialSupported: false, reasons }
  }

  // --- Weak evidence ----------------------------------------------------
  if (framesObserved < MIN_OBSERVATION_FRAMES) {
    reasons.push(
      `Only ${framesObserved} frame(s) observed; ${MIN_OBSERVATION_FRAMES} are needed before trusting the verdict.`,
    )
    return { level: 'degraded', spatialSupported: false, reasons }
  }

  if (report.clipped) {
    reasons.push('Clipping detected in the capture; levels are not trustworthy.')
    return { level: 'degraded', spatialSupported: false, reasons }
  }

  if (maxPairCorrelation > 0.9) {
    reasons.push(
      'Channels are highly correlated (' +
        maxPairCorrelation.toFixed(3) +
        '); independence is questionable.',
    )
    return { level: 'degraded', spatialSupported: false, reasons }
  }

  if (report.energyRatio < ENERGY_IMBALANCE_RATIO) {
    reasons.push(
      'Channel levels are badly imbalanced (ratio ' +
        report.energyRatio.toFixed(4) +
        '); one channel may be disconnected or muted.',
    )
    return { level: 'degraded', spatialSupported: false, reasons }
  }

  return { level: 'qualified', spatialSupported: true, reasons }
}

/**
 * Accumulate channel statistics across frames, without allocating per frame.
 *
 * The worklet runs this on the audio thread, so it holds only running sums and
 * never allocates: `observe()` must stay allocation-free.
 */
export class ChannelProbe {
  private _sumXY = 0
  private _sumXX = 0
  private _sumYY = 0
  private _frames = 0
  private _clipped = false
  private _channels = 0

  /** Feed one frame (`channels[c][i]`). Allocation-free by contract. */
  observe(channels: Float32Array[]): void {
    this._channels = channels.length
    this._frames += 1
    if (channels.length < 2) return
    const a = channels[0]
    const b = channels[1]
    const n = Math.min(a.length, b.length)
    for (let i = 0; i < n; i++) {
      const x = a[i]
      const y = b[i]
      this._sumXX += x * x
      this._sumYY += y * y
      this._sumXY += x * y
      if (x >= 1 || x <= -1 || y >= 1 || y <= -1) {
        this._clipped = true
      }
    }
  }

  /** min/max per-channel energy over the window, in [0,1]. */
  get energyRatio(): number {
    const lo = Math.min(this._sumXX, this._sumYY)
    const hi = Math.max(this._sumXX, this._sumYY)
    if (hi === 0) return 0
    return Math.min(1, lo / hi)
  }

  get frames(): number {
    return this._frames
  }

  get channels(): number {
    return this._channels
  }

  get clipped(): boolean {
    return this._clipped
  }

  /** Normalised zero-lag correlation in [0,1]; 1 = identical signals. */
  get correlation(): number {
    const denom = Math.sqrt(this._sumXX * this._sumYY)
    if (denom === 0 || !Number.isFinite(denom)) {
      // Silent input carries no independence evidence.
      return 1
    }
    const c = Math.abs(this._sumXY) / denom
    return Number.isFinite(c) ? Math.min(1, c) : 1
  }
}