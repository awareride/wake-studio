/**
 * AFE graph - capture geometry (issue #245, browser half).
 *
 * These tests exist because the device side already had this contract and the
 * browser did not: the worklet read `inputs[0][0]` and everything downstream
 * assumed a single mono stream. The assertions therefore cover the three
 * shapes the browser capture can actually produce, and the refusals that keep
 * a spatial stage from running on a capture that has not earned it.
 */

import { describe, it, expect } from 'vitest'
import {
  AFEGeometryError,
  MAX_AFE_CHANNELS,
  downmixToMono,
  planStage,
  servedMicChannels,
  stageGeometry,
  validateGeometry,
} from '../core/geometry'
import type { DeliveredGeometry } from '../core/geometry'
import { MONO_STAGE_GEOMETRY } from '@wake-studio/contracts'
import type { AFEStageGeometry } from '@wake-studio/contracts'

const MONO_DELIVERED: DeliveredGeometry = { micChannels: 1, referenceChannels: 0 }

describe('validateGeometry', () => {
  it('accepts the single-mic default and a declared array', () => {
    expect(() => validateGeometry({ channels: 1, referenceChannels: 0 })).not.toThrow()
    expect(() => validateGeometry({ channels: 4, referenceChannels: 1 })).not.toThrow()
  })

  it('rejects out-of-range channel counts instead of clamping', () => {
    // Silently serving fewer channels than the project declared is the failure
    // this issue removes; the declaration must be honoured or refused.
    expect(() => validateGeometry({ channels: 0, referenceChannels: 0 })).toThrow(AFEGeometryError)
    expect(() => validateGeometry({ channels: MAX_AFE_CHANNELS + 1, referenceChannels: 0 })).toThrow(
      /1\.\.[0-9]+/,
    )
    expect(() => validateGeometry({ channels: 1, referenceChannels: -1 })).toThrow(AFEGeometryError)
  })

  it('rejects non-integer channel counts', () => {
    expect(() => validateGeometry({ channels: 1.5, referenceChannels: 0 })).toThrow(/integer/)
  })
})

describe('stageGeometry', () => {
  it('treats a stage that omits geometry as single-mic', () => {
    expect(stageGeometry(undefined)).toEqual(MONO_STAGE_GEOMETRY)
  })

  it('returns the declared geometry unchanged', () => {
    const g: AFEStageGeometry = { inputChannels: 2, outputChannels: 1, referenceChannels: 0 }
    expect(stageGeometry(g)).toBe(g)
  })
})

describe('planStage', () => {
  it('feeds a mono stage on a mono capture directly (the default path)', () => {
    const p = planStage(MONO_STAGE_GEOMETRY, MONO_DELIVERED)
    expect(p).toEqual({ action: 'direct', micChannels: 1, referenceChannels: 0 })
  })

  it('downmixes a multi-channel capture for a mono-declared stage', () => {
    const p = planStage(MONO_STAGE_GEOMETRY, { micChannels: 2, referenceChannels: 0 })
    expect(p.action).toBe('downmix')
    expect(p.micChannels).toBe(1)
  })

  it('feeds a spatial stage directly when the capture delivers its channels', () => {
    const p = planStage(
      { inputChannels: 2, outputChannels: 2, referenceChannels: 0 },
      { micChannels: 2, referenceChannels: 0 },
    )
    expect(p).toEqual({ action: 'direct', micChannels: 2, referenceChannels: 0 })
  })

  it('refuses a spatial stage when the capture is short of channels', () => {
    const p = planStage(
      { inputChannels: 2, outputChannels: 1, referenceChannels: 0 },
      MONO_DELIVERED,
    )
    expect(p.action).toBe('refuse')
    expect(p.reason).toMatch(/needs 2 mic channel/)
  })

  it('refuses a reference-declaring stage when no reference exists', () => {
    // The structural reason an AEC cannot run on a capture without a
    // reference: the declaration is checked, not a runtime toggle.
    const aec: AFEStageGeometry = { inputChannels: 1, outputChannels: 1, referenceChannels: 1 }
    expect(planStage(aec, MONO_DELIVERED).action).toBe('refuse')
    expect(planStage(aec, MONO_DELIVERED).reason).toMatch(/far-end reference/)
  })

  it('serves a reference-declaring stage when a reference path exists', () => {
    const aec: AFEStageGeometry = { inputChannels: 1, outputChannels: 1, referenceChannels: 1 }
    const p = planStage(aec, { micChannels: 1, referenceChannels: 1 })
    expect(p).toEqual({ action: 'direct', micChannels: 1, referenceChannels: 1 })
  })

  it('refuses when only part of a reference arrived', () => {
    const aec: AFEStageGeometry = { inputChannels: 1, outputChannels: 1, referenceChannels: 2 }
    expect(planStage(aec, { micChannels: 1, referenceChannels: 1 }).action).toBe('refuse')
  })
})

describe('downmixToMono', () => {
  it('averages the delivered planes into the scratch buffer', () => {
    const a = new Float32Array([1, 0, 0.5])
    const b = new Float32Array([0, 1, 0.5])
    const out = new Float32Array(3)
    downmixToMono([a, b], out)
    expect(Array.from(out)).toEqual([0.5, 0.5, 0.5])
  })

  it('handles a single plane without needing two', () => {
    const a = new Float32Array([0.25, -0.5])
    const out = new Float32Array(2)
    downmixToMono([a], out)
    expect(Array.from(out)).toEqual([0.25, -0.5])
  })

  it('tolerates channels shorter than the output (pad with what exists)', () => {
    const out = new Float32Array(3)
    downmixToMono([new Float32Array([1])], out)
    expect(Array.from(out)).toEqual([1, 0, 0])
  })

  it('is a no-op on an empty delivery rather than producing NaN', () => {
    const out = new Float32Array(2).fill(1)
    downmixToMono([], out)
    expect(Array.from(out)).toEqual([0, 0])
  })
})

describe('servedMicChannels', () => {
  it('serves the declared channels when the capture is qualified', () => {
    expect(servedMicChannels({ channels: 2, referenceChannels: 0 }, true).micChannels).toBe(2)
  })

  it('serves mono and explains why when the capture is not qualified', () => {
    // #246: a stereo-looking stream is not evidence of two microphones, so the
    // delivery boundary enforces mono, not just the UI.
    const r = servedMicChannels({ channels: 2, referenceChannels: 0 }, false)
    expect(r.micChannels).toBe(1)
    expect(r.reason).toMatch(/not qualified/)
  })

  it('never adds channels the project did not declare', () => {
    expect(servedMicChannels({ channels: 1, referenceChannels: 0 }, true).micChannels).toBe(1)
  })
})
