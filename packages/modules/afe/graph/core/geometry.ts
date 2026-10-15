/**
 * AFE module - capture/array geometry (issue #245, browser half).
 *
 * The device side declares geometry in `wake_afe_stage_ops_t` and the graph
 * there validates it per frame (docs/modules/sdk.md §4.2.2). This is the same
 * contract expressed for the browser: a project declares how many mic channels
 * and how many far-end reference channels its capture has, each stage declares
 * what it consumes and produces, and the graph serves the difference.
 *
 * Three rules, in priority order, mirroring the device graph:
 *
 *   1. A stage is never fed fewer channels than it declared (refused).
 *   2. A stage declaring a far-end reference is refused on a capture without
 *      one. That is the structural reason an AEC can only run where a
 *      reference path exists — it is not a runtime toggle.
 *   3. A mono-declared stage on a multi-channel capture is fed the graph's
 *      downmix (`downmix`), so single-mic behaviour is the degenerate case of
 *      the same path rather than a separate code path.
 *
 * Everything here is pure and allocation-free by construction so it can run on
 * the main thread (validation) and be unit-tested without a browser. The
 * worklet only maps the results onto its preallocated buffers.
 */

import type { AFEStageGeometry } from '@wake-studio/contracts'
import { MONO_STAGE_GEOMETRY } from '@wake-studio/contracts'

/**
 * Upper bound on mic and reference channels, mirroring the device graph's
 * `WAKE_AFE_MAX_CHANNELS` (device/core/include/wake/afe_graph.h). Chosen to be
 * generous for the array sizes WakeStudio targets while keeping the worklet's
 * static storage predictable.
 */
export const MAX_AFE_CHANNELS = 4

/** Configuration fields that describe a capture's geometry. */
export interface GeometryConfig {
  /** Mic channels the project declares (1 = single mic, the default). */
  channels: number
  /** Far-end (render) channels available to the capture (0 = none). */
  referenceChannels: number
}

/** What the audio thread actually delivered this run. */
export interface DeliveredGeometry {
  /** `inputs[0].length` — the real channel count, not the requested one. */
  micChannels: number
  /** `inputs[1]` plane count actually wired in (0 when there is no reference). */
  referenceChannels: number
}

/** Stage declared geometry, or the mono default when a stage omits it. */
export function stageGeometry(declared: AFEStageGeometry | undefined): AFEStageGeometry {
  return declared ?? MONO_STAGE_GEOMETRY
}

export class AFEGeometryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AFEGeometryError'
  }
}

function checkChannels(field: string, value: unknown): void {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new AFEGeometryError(`AFE geometry ${field} must be an integer, got ${JSON.stringify(value)}`)
  }
}

/**
 * Validate a declared capture geometry. Fails loudly (main thread) rather than
 * clamping: a project that declares a 5-channel array or a fractional channel
 * count is misconfigured, and silently serving fewer channels than the user
 * declared is the failure mode this issue exists to remove.
 */
export function validateGeometry(config: GeometryConfig): void {
  checkChannels('channels', config.channels)
  checkChannels('referenceChannels', config.referenceChannels)
  if (config.channels < 1 || config.channels > MAX_AFE_CHANNELS) {
    throw new AFEGeometryError(
      `AFE geometry channels must be 1..${MAX_AFE_CHANNELS}, got ${config.channels}`,
    )
  }
  if (config.referenceChannels < 0 || config.referenceChannels > MAX_AFE_CHANNELS) {
    throw new AFEGeometryError(
      `AFE geometry referenceChannels must be 0..${MAX_AFE_CHANNELS}, got ${config.referenceChannels}`,
    )
  }
}

/** What the graph should do with one stage for one delivered geometry. */
export type GeometryAction =
  /** Feed the stage directly: delivered == declared, no conversion. */
  | 'direct'
  /** Downmix the delivered channels to the stage's declared mono input. */
  | 'downmix'
  /** Refuse to run the stage this frame; `reason` says why. */
  | 'refuse'

export interface StageGeometryPlan {
  action: GeometryAction
  /** Mic channels the stage will actually receive. */
  micChannels: number
  /** Reference channels the stage will actually receive. */
  referenceChannels: number
  /** Present for `refuse`; safe to surface in the UI. */
  reason?: string
}

/**
 * Decide how one stage is served for one delivered geometry.
 *
 * Fails safe: a stage is only `direct` when the delivery matches its
 * declaration exactly. Anything else is either converted by the graph
 * (`downmix`) or not run at all (`refuse`) — a stage never sees a surprise.
 */
export function planStage(
  declared: AFEStageGeometry | undefined,
  delivered: DeliveredGeometry,
): StageGeometryPlan {
  const geo = stageGeometry(declared)

  if (delivered.micChannels < geo.inputChannels) {
    return {
      action: 'refuse',
      micChannels: 0,
      referenceChannels: 0,
      reason:
        `stage needs ${geo.inputChannels} mic channel(s) but the capture delivered ` +
        `${delivered.micChannels}; the stage is not run this frame`,
    }
  }

  if (geo.referenceChannels > 0 && delivered.referenceChannels < geo.referenceChannels) {
    return {
      action: 'refuse',
      micChannels: 0,
      referenceChannels: 0,
      reason:
        `stage needs ${geo.referenceChannels} far-end reference channel(s) but none is ` +
        `available (capture provides ${delivered.referenceChannels}); an AEC can only run ` +
        `where a reference path exists`,
    }
  }

  if (geo.inputChannels === 1 && delivered.micChannels > 1) {
    return { action: 'downmix', micChannels: 1, referenceChannels: geo.referenceChannels }
  }

  return {
    action: 'direct',
    micChannels: Math.min(geo.inputChannels, delivered.micChannels),
    referenceChannels: Math.min(geo.referenceChannels, delivered.referenceChannels),
  }
}

/**
 * Mix every delivered channel into one mono plane, in place, without
 * allocating: the worklet passes a preallocated scratch buffer as `out`.
 *
 * The graph owns this conversion exactly as the device graph does (a stage
 * declaring fewer channels than the capture has is fed a converted buffer), so
 * a single-mic project stays the zero-conversion, zero-allocation path.
 */
export function downmixToMono(channels: ReadonlyArray<Float32Array>, out: Float32Array): void {
  out.fill(0)
  if (channels.length === 0) return
  const n = out.length
  for (let c = 0; c < channels.length; c++) {
    const plane = channels[c]
    const count = Math.min(n, plane.length)
    for (let i = 0; i < count; i++) {
      out[i] += plane[i]
    }
  }
  const scale = 1 / channels.length
  for (let i = 0; i < n; i++) {
    out[i] *= scale
  }
}

/**
 * Caller-side gate: the graph serves a geometry, the caller decides whether the
 * capture earned it (#246). A project declaring more mic channels than the
 * capture has proven to carry only gets mono, and is told why — spatial
 * processing on an unqualified capture is precisely the failure #246 exists to
 * prevent, so this is enforced at the delivery boundary, not in the UI alone.
 */
export function servedMicChannels(
  config: GeometryConfig,
  spatialSupported: boolean,
): { micChannels: number; reason?: string } {
  if (config.channels > 1 && !spatialSupported) {
    return {
      micChannels: 1,
      reason:
        `capture declares ${config.channels} channel(s) but is not qualified for spatial ` +
        `processing (#246); serving mono until it is`,
    }
  }
  return { micChannels: config.channels }
}
