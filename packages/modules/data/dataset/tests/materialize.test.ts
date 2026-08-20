/**
 * Dataset module - materializer tests (#206).
 *
 * Covers the role → folder maps (the per-trainer shape contract) and the
 * pre-train `spec.train.dataset` validation the wizard picker runs: clear
 * warnings/errors instead of a cryptic trainer crash. The backend twin
 * (wake_train_kit/materialize.py) mirrors these rules.
 */

import { describe, expect, it } from 'vitest'
import {
  KWS_STREAMING_MATERIALIZER,
  OPENWAKEWORD_MATERIALIZER,
  materializerFor,
  roleFolderName,
  validateDatasetRequirements,
  planKwsStreamingLayout,
  type DatasetValidationInput,
} from '../core/materialize'
import type { DatasetManifest } from '../core/spec'

function manifest(overrides: Partial<DatasetManifest> = {}): DatasetManifest {
  return {
    schemaVersion: 1,
    id: 'ds-1',
    name: 'wake-words',
    version: 1,
    kind: 'generated',
    role: 'mixed',
    audio: { sampleRate: 16000, channels: 1, encoding: 'pcm_s16le', clips: 4, durationSec: 8 },
    labels: [
      { name: 'hey_studio', role: 'positive' },
      { name: '_unknown', role: 'unknown' },
      { name: 'noise', role: 'noise' },
    ],
    provenance: [{ name: 'edge-tts', license: 'user-owned', commercialUse: true }],
    ...overrides,
  }
}

const req = { sampleRate: 16000, needsNoise: true, needsUnknowns: true, labelMode: 'multi' } as const

describe('materializer descriptors', () => {
  it('kws-streaming maps roles to the label/*.wav tree folders', () => {
    expect(KWS_STREAMING_MATERIALIZER.id).toBe('kws-streaming')
    expect(KWS_STREAMING_MATERIALIZER.roleMap.noise).toEqual({ kind: 'folder', name: '_background_noise_' })
    // positive labels become the wanted (wake-word) folders
    expect(roleFolderName('kws-streaming', 'positive', { name: 'hey_studio', role: 'positive' })).toBe('hey_studio')
    // unknowns keep their label folder (upstream folds them into _unknown_)
    expect(roleFolderName('kws-streaming', 'unknown', { name: '_unknown', role: 'unknown' })).toBe('_unknown')
    expect(roleFolderName('kws-streaming', 'noise')).toBe('_background_noise_')
  })

  it('openwakeword maps positives to a dir, unknowns to features, noise to background', () => {
    expect(OPENWAKEWORD_MATERIALIZER.id).toBe('openwakeword')
    expect(OPENWAKEWORD_MATERIALIZER.roleMap.positive.kind).toBe('folder')
    expect(OPENWAKEWORD_MATERIALIZER.roleMap.unknown.kind).toBe('feature-file')
    expect(OPENWAKEWORD_MATERIALIZER.roleMap.noise.kind).toBe('folder')
    expect(materializerFor('kws-streaming')?.id).toBe('kws-streaming')
    expect(materializerFor('nope')).toBeUndefined()
  })
})

describe('validateDatasetRequirements', () => {
  it('accepts a complete dataset set', () => {
    const v = validateDatasetRequirements([{ manifest: manifest() }], req)
    expect(v.ok).toBe(true)
    expect(v.errors).toEqual([])
  })

  it('blocks when noise is required but absent', () => {
    const m = manifest({ labels: [
      { name: 'hey_studio', role: 'positive' },
      { name: '_unknown', role: 'unknown' },
    ] })
    const v = validateDatasetRequirements([{ manifest: m }], req)
    expect(v.ok).toBe(false)
    expect(v.errors.some((e) => e.includes('noise'))).toBe(true)
  })

  it('blocks when unknowns are required but absent', () => {
    const m = manifest({ labels: [
      { name: 'hey_studio', role: 'positive' },
      { name: 'noise', role: 'noise' },
    ] })
    const v = validateDatasetRequirements([{ manifest: m }], req)
    expect(v.ok).toBe(false)
    expect(v.errors.some((e) => e.includes('_unknown_'))).toBe(true)
  })

  it('blocks single-word trainers with more than one positive label', () => {
    const m = manifest({ labels: [
      { name: 'hey_studio', role: 'positive' },
      { name: 'good_morning', role: 'positive' },
      { name: 'noise', role: 'noise' },
    ] })
    const v = validateDatasetRequirements([{ manifest: m }], { labelMode: 'single' })
    expect(v.ok).toBe(false)
    expect(v.errors.some((e) => e.includes('single'))).toBe(true)
  })

  it('validates the COMBINED view (positives from one dataset, noise from another)', () => {
    const pos = manifest({ id: 'pos', name: 'positives', labels: [{ name: 'hey_studio', role: 'positive' }] })
    const noise = manifest({ id: 'noise-ds', name: 'noise', labels: [{ name: 'noise', role: 'noise' }] })
    const v = validateDatasetRequirements(
      [{ manifest: pos }, { manifest: noise }],
      { needsNoise: true, needsUnknowns: false, labelMode: 'single' },
    )
    expect(v.ok).toBe(true)
  })

  it('errors on a sample-rate mismatch', () => {
    const m = manifest({ audio: { sampleRate: 22050, channels: 1, encoding: 'pcm_s16le', clips: 4, durationSec: 8 } })
    const v = validateDatasetRequirements([{ manifest: m }], { sampleRate: 16000 })
    expect(v.ok).toBe(false)
    expect(v.errors.some((e) => e.includes('22050'))).toBe(true)
  })

  it('warns on thin labels using exact clip counts', () => {
    const v = validateDatasetRequirements(
      [{ manifest: manifest(), clipsPerLabel: { hey_studio: 2, _unknown: 1, noise: 1 } }],
      { minClipsPerLabel: 50 },
    )
    expect(v.ok).toBe(true) // thin labels are a warning, not a blocker
    expect(v.warnings.some((w) => w.includes('hey_studio') && w.includes('50'))).toBe(true)
  })

  it('warns when a dataset is not commercially usable', () => {
    const m = manifest({ provenance: [{ name: 'x', license: 'NC', commercialUse: false }] })
    const v = validateDatasetRequirements([{ manifest: m }], { labelMode: 'single' })
    expect(v.ok).toBe(true)
    expect(v.warnings.some((w) => w.includes('NOT commercially usable'))).toBe(true)
  })

  it('requires at least one dataset', () => {
    const v = validateDatasetRequirements([], req)
    expect(v.ok).toBe(false)
    expect(v.errors[0]).toMatch(/at least one dataset/)
  })

  it('validates against the shipped spec.train.dataset values (wizard picker)', () => {
    // kws-streaming: multi-word, needs noise + unknowns
    const kws = {
      sampleRate: 16000,
      minClipsPerLabel: 10,
      needsNoise: true,
      needsUnknowns: true,
      labelMode: 'multi' as const,
    }
    const complete = validateDatasetRequirements([{ manifest: manifest() }], kws)
    expect(complete.ok).toBe(true)
    // a positives-only dataset is rejected with clear errors (no crash)
    const onlyPos = manifest({ labels: [{ name: 'hey_studio', role: 'positive' }] })
    const blocked = validateDatasetRequirements([{ manifest: onlyPos }], kws)
    expect(blocked.ok).toBe(false)
    expect(blocked.errors.some((e) => e.includes('noise'))).toBe(true)
    expect(blocked.errors.some((e) => e.includes('_unknown_'))).toBe(true)

    // openwakeword: single-word — two positive labels must be rejected
    const oww = {
      sampleRate: 16000,
      minClipsPerLabel: 100,
      needsNoise: true,
      needsUnknowns: true,
      labelMode: 'single' as const,
    }
    const twoWords = manifest({ labels: [
      { name: 'hey_studio', role: 'positive' },
      { name: 'good_morning', role: 'positive' },
      { name: '_unknown', role: 'unknown' },
      { name: 'noise', role: 'noise' },
    ] })
    const owwBlocked = validateDatasetRequirements([{ manifest: twoWords }], oww)
    expect(owwBlocked.ok).toBe(false)
    expect(owwBlocked.errors.some((e) => e.includes('single'))).toBe(true)
  })
})

describe('planKwsStreamingLayout', () => {
  it('derives wanted words + noise folder from the merged manifests', () => {
    const plan = planKwsStreamingLayout([
      { manifest: manifest() },
    ])
    expect(plan.wantedWords).toEqual(['hey_studio'])
    expect(plan.unknownLabels).toEqual(['_unknown'])
    expect(plan.noiseFolder).toBe(true)
  })

  it('merges roles across datasets', () => {
    const pos = manifest({ id: 'pos', name: 'positives', labels: [{ name: 'hey_studio', role: 'positive' }] })
    const noise = manifest({ id: 'noise-ds', name: 'noise', labels: [{ name: 'noise', role: 'noise' }] })
    const plan = planKwsStreamingLayout([{ manifest: pos }, { manifest: noise }])
    expect(plan.wantedWords).toEqual(['hey_studio'])
    expect(plan.noiseFolder).toBe(true)
  })

  it('sees no noise folder when no noise label', () => {
    const m = manifest({ labels: [{ name: 'hey_studio', role: 'positive' }] })
    expect(planKwsStreamingLayout([{ manifest: m }]).noiseFolder).toBe(false)
  })
})

// Keep the type import referenced for editors (it is the picker's input type).
export type _Input = DatasetValidationInput
