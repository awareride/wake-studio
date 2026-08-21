/**
 * Dataset module — browser generation helpers (ADR-044 §5, #208).
 *
 * Pure + L1: WAV container encoding, the deterministic silence clip, manifest
 * building (mirrors the backend `build_manifest`) and the canonical zip
 * assembly (contentHash embedded before zipping, byte-compatible with the
 * backend importer).
 */

import { describe, expect, it } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import {
  assembleDatasetZip,
  buildGeneratedManifest,
  isWavBytes,
  pcmToWav,
  sanitizeLabel,
  writeSilenceWav,
  type GenerationParams,
} from '../core/generate'
import { importDatasetZip } from '../core/manifest'
import type { DatasetManifest } from '../core/spec'

describe('sanitizeLabel', () => {
  it('lowercases and replaces non-word characters like the backend', () => {
    expect(sanitizeLabel('Hey Studio')).toBe('hey_studio')
    expect(sanitizeLabel('  wake-up  ')).toBe('wake-up')
    // All non-word chars collapse to a single '_' (truthy, so NOT 'word')
    expect(sanitizeLabel('!!!')).toBe('_')
  })
})

describe('pcmToWav / isWavBytes', () => {
  it('wraps raw PCM in a valid 16-bit mono WAV container', () => {
    const pcm = new Uint8Array([0, 0, 0, 0, 0xff, 0x7f, 0, 0x80])
    const wav = pcmToWav(pcm, 16000)
    expect(isWavBytes(wav)).toBe(true)
    // 44-byte header + data
    expect(wav.byteLength).toBe(44 + pcm.byteLength)
    const view = new DataView(wav.buffer)
    expect(view.getUint32(24, true)).toBe(16000) // sample rate
    expect(view.getUint16(22, true)).toBe(1) // mono
    expect(view.getUint16(34, true)).toBe(16) // 16-bit
    expect(view.getUint32(40, true)).toBe(pcm.byteLength) // data size
  })

  it('detects RIFF/WAVE bytes', () => {
    expect(isWavBytes(pcmToWav(new Uint8Array(4), 16000))).toBe(true)
    expect(isWavBytes(new Uint8Array([0, 1, 2, 3]))).toBe(false)
  })
})

describe('writeSilenceWav', () => {
  it('produces a deterministic 1s silence WAV', () => {
    const wav = writeSilenceWav(1.0, 16000)
    expect(isWavBytes(wav)).toBe(true)
    // 1s at 16 kHz mono 16-bit = 32000 bytes of data
    expect(wav.byteLength).toBe(44 + 32000)
    // all data bytes are 0 (silence)
    for (let i = 44; i < wav.byteLength; i++) expect(wav[i]).toBe(0)
  })
})

describe('buildGeneratedManifest', () => {
  const params: GenerationParams = {
    engine: 'mimo-tts',
    phrases: ['hey studio', 'good morning'],
    languages: ['en-US'],
    samplesPerPhrase: 3,
  }

  it('mirrors the backend manifest shape (generated, mixed, canonical audio)', () => {
    const manifest = buildGeneratedManifest(params, [
      { name: 'hey_studio', role: 'positive', language: 'en-US', source: 'synthetic' },
      { name: 'good_morning', role: 'positive', language: 'en-US', source: 'synthetic' },
      { name: '_background_noise_', role: 'noise', source: 'synthetic' },
    ], 9, 123)
    expect(manifest.kind).toBe('generated')
    expect(manifest.role).toBe('mixed')
    expect(manifest.audio).toMatchObject({ sampleRate: 16000, channels: 1, encoding: 'pcm_s16le', clips: 9 })
    expect(manifest.recipe).toMatchObject({ engine: 'mimo-tts', phrases: ['hey studio', 'good morning'], seed: 0 })
    expect(manifest.provenance[0].commercialUse).toBe(true)
  })

  it('derives a name from the first phrase + languages when not given', () => {
    const manifest = buildGeneratedManifest(params, [], 0, 0)
    expect(manifest.name).toBe('hey_studio-en-US')
  })

  it('uses the explicit name + datasetId when provided', () => {
    const manifest = buildGeneratedManifest({ ...params, name: 'My set', datasetId: 'abc-123' }, [], 0, 0)
    expect(manifest.name).toBe('My set')
    expect(manifest.id).toBe('abc-123')
  })
})

describe('assembleDatasetZip', () => {
  it('embeds contentHash and produces a zip the shared importer accepts', async () => {
    const params: GenerationParams = { engine: 'mimo-tts', phrases: ['wake up'] }
    const manifest = buildGeneratedManifest(params, [
      { name: 'wake_up', role: 'positive', source: 'synthetic' },
      { name: '_background_noise_', role: 'noise', source: 'synthetic' },
    ], 2, 0)
    const clips = {
      wake_up: [
        { name: 'en-US_0.wav', bytes: writeSilenceWav(0.5, 16000) },
        { name: 'en-US_1.wav', bytes: writeSilenceWav(0.5, 16000) },
      ],
      _background_noise_: [{ name: 'silence_0.wav', bytes: writeSilenceWav(1.0, 16000) }],
    }
    const { manifest: final, zipBytes } = await assembleDatasetZip(manifest, clips)
    // Bare sha256 hex (the backend + web importer compare the same form).
    expect(final.contentHash).toMatch(/^[0-9a-f]{64}$/)

    // The zip must contain dataset.json + the audio tree.
    const entries = unzipSync(zipBytes)
    expect(entries['dataset.json']).toBeTruthy()
    expect(entries['audio/wake_up/en-US_0.wav']).toBeTruthy()
    const parsed = JSON.parse(strFromU8(entries['dataset.json'])) as DatasetManifest
    expect(parsed.contentHash).toBe(final.contentHash)

    // Round-trip through the real importer (the same code path the console
    // and the backend store use) — proves byte-compatibility.
    const bundle = await importDatasetZip(zipBytes)
    expect(bundle.manifest.id).toBe(final.id)
    expect(bundle.clips.wake_up).toHaveLength(2)
  })
})
