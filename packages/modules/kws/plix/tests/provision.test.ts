/**
 * kws-plix provisioning capability tests (ADR-033).
 *
 * The plix driver produces the wake-word artifact it loads with: an enrolled
 * prototype. produce() turns enrolled mic samples (embeddings) into the
 * serialized artifact; apply() maps it into the engine load backend config.
 *
 * The capability is read through the registry (the registration is the only
 * surface hosts see), so these tests also lock the registration shape.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { getBackendRegistration } from '@wake-studio/module-kws-engine'
import type { EnrolledSample } from '@wake-studio/module-few-shot'
import '@wake-studio/module-kws-plix'

function makeSample(seed: number, id: string): EnrolledSample {
  // Two-dim embeddings for easy assertions (mean-pooling, vectors).
  const embedding = new Float32Array([seed, seed + 1])
  return {
    id,
    samples: new Float32Array(16000),
    sampleRate: 16000,
    embedding,
    quality: {
      peakDbfs: -20,
      snrDb: 20,
      durationMs: 1000,
      clipped: false,
      acceptable: true,
    },
    recordedAtMs: Date.now(),
  }
}

type PlixProvision = NonNullable<
  NonNullable<ReturnType<typeof getBackendRegistration>>['provision']
>

describe('plixkws provisioning capability (ADR-033)', () => {
  let provision: PlixProvision

  beforeEach(() => {
    const reg = getBackendRegistration('plixkws')
    expect(reg?.provision).toBeDefined()
    provision = reg!.provision!
  })

  it('declares kind prototype with a provisioning spec', () => {
    expect(provision.kind).toBe('prototype')
    // The spec drives the enrollment panel: record/enroll/start actions.
    const actionIds = provision.spec?.actions.map((a) => a.id) ?? []
    expect(actionIds).toContain('record')
    expect(actionIds).toContain('enroll')
    expect(actionIds).toContain('start')
  })

  it('produce() mean-pools sample embeddings into a prototype artifact', async () => {
    const artifact = await provision.produce({
      word: 'hey-buddy',
      samples: [makeSample(1, 'a'), makeSample(3, 'b')],
    })
    expect(artifact.kind).toBe('prototype')
    expect(artifact.backendId).toBe('plixkws')
    if (artifact.kind !== 'prototype') return
    expect(artifact.payload.word).toBe('hey-buddy')
    // mean of [1,2] and [3,4]
    expect(artifact.payload.vector).toEqual([2, 3])
    expect(artifact.payload.sampleIds).toEqual(['a', 'b'])
    expect(artifact.payload.negativeVector).toBeUndefined()
  })

  it('produce() includes the negative-class vector when negative samples are given', async () => {
    const artifact = await provision.produce({
      word: 'hey-buddy',
      samples: [makeSample(1, 'a')],
      negativeSamples: [makeSample(10, 'n1'), makeSample(12, 'n2')],
    })
    if (artifact.kind !== 'prototype') return
    expect(artifact.payload.negativeVector).toEqual([11, 12])
  })

  it('produce() rejects zero samples', async () => {
    await expect(provision.produce({ word: 'x', samples: [] })).rejects.toThrow(
      'zero samples',
    )
  })

  it('apply() maps the prototype artifact into the backendConfig', async () => {
    const artifact = await provision.produce({
      word: 'hey-buddy',
      samples: [makeSample(1, 'a'), makeSample(3, 'b')],
      negativeSamples: [makeSample(10, 'n1')],
    })
    const applied = provision.apply(artifact)
    // Prototype vectors ride in backendConfig (opaque to the host; the
    // worker's plixkws load branch reads them). No URLs - the encoder URLs
    // come from the driver's resolveModelUrls.
    expect(applied.urls).toBeUndefined()
    expect(applied.backendConfig?.prototype).toEqual([2, 3])
    expect(applied.backendConfig?.prototypeNegative).toEqual([10, 11])
  })

  it('apply() rejects a non-prototype artifact', () => {
    expect(() =>
      provision.apply({
        kind: 'list',
        backendId: 'plixkws',
        payload: { keywords: 'x' },
      }),
    ).toThrow('only consumes prototype artifacts')
  })
})
