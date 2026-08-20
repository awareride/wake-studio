import { describe, it, expect } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import {
  importDatasetZip,
  DatasetImportError,
  DATASET_IMPORT_ERROR_MESSAGES,
  type DatasetBundle,
} from '../core/manifest'
import {
  validateDatasetManifest,
  DATASET_MANIFEST_SCHEMA_VERSION,
  CANONICAL_ENCODING,
  type DatasetManifest,
} from '../core/spec'
import { datasetContentHash, type ClipTree } from '../core/hash'

function validManifest(): DatasetManifest {
  return {
    schemaVersion: DATASET_MANIFEST_SCHEMA_VERSION,
    id: 'ds-1',
    name: 'wake-words-zh-en',
    version: 1,
    kind: 'generated',
    role: 'mixed',
    audio: { sampleRate: 16000, channels: 1, encoding: CANONICAL_ENCODING, clips: 3, durationSec: 6 },
    labels: [
      { name: 'hey_studio', role: 'positive' },
      { name: 'noise', role: 'noise' },
    ],
    provenance: [{ name: 'edge-tts synthetic speech', license: 'user-owned (synthetic TTS)', commercialUse: true }],
    recipe: { engine: 'edge-tts', seed: 0 },
  }
}

type ZipClips = Record<string, Record<string, Uint8Array>>

/** Build a `wake-studio-dataset.zip` in memory (canonical layout, §4.1). */
function buildZip(manifest: DatasetManifest, clips: ZipClips): Uint8Array {
  const entries: Record<string, Uint8Array> = {
    'dataset.json': strToU8(JSON.stringify(manifest)),
  }
  for (const [label, clipMap] of Object.entries(clips)) {
    for (const [name, bytes] of Object.entries(clipMap)) {
      entries[`audio/${label}/${name}`] = bytes
    }
  }
  return zipSync(entries)
}

/** Convert a zip clip map into the ClipTree hashing form. */
function toClipTree(clips: ZipClips): ClipTree {
  const tree: ClipTree = {}
  for (const [label, clipMap] of Object.entries(clips)) {
    tree[label] = Object.entries(clipMap).map(([name, bytes]) => ({ name, bytes }))
  }
  return tree
}

const WAV = strToU8('RIFFfakewav')

function clipsFixture(): ZipClips {
  return {
    hey_studio: { 'a.wav': WAV, 'b.wav': WAV },
    noise: { 'bg.wav': WAV },
  }
}

describe('wake-studio-dataset.zip importer (ADR-044 §4, task #203)', () => {
  it('imports a valid dataset and indexes the canonical audio tree', async () => {
    const manifest = validManifest()
    const bundle = await importDatasetZip(buildZip(manifest, clipsFixture()))
    expect(bundle.manifest.id).toBe('ds-1')
    expect(bundle.clips.hey_studio).toHaveLength(2)
    expect(bundle.clips.noise).toHaveLength(1)
  })

  it('rejects a non-zip input', async () => {
    await expect(importDatasetZip(strToU8('not a zip'))).rejects.toBeInstanceOf(DatasetImportError)
    await expect(importDatasetZip(new Uint8Array(0))).rejects.toThrow(
      DATASET_IMPORT_ERROR_MESSAGES['no-zip'],
    )
  })

  it('rejects an empty zip', async () => {
    await expect(importDatasetZip(zipSync({}))).rejects.toMatchObject({
      code: 'empty-zip',
    })
  })

  it('rejects a zip missing dataset.json', async () => {
    const zip = zipSync({ 'audio/hey_studio/a.wav': WAV })
    await expect(importDatasetZip(zip)).rejects.toMatchObject({
      code: 'missing-manifest',
    })
  })

  it('rejects a zip with an invalid dataset.json', async () => {
    const manifest = { ...validManifest(), version: 0 } // invalid
    await expect(importDatasetZip(buildZip(manifest, clipsFixture()))).rejects.toMatchObject({
      code: 'invalid-manifest',
    })
  })

  it('rejects a manifest declaring a label with no clips', async () => {
    const manifest = validManifest()
    await expect(importDatasetZip(buildZip(manifest, { hey_studio: { 'a.wav': WAV } }))).rejects.toMatchObject({
      code: 'missing-clips',
    })
  })

  it('accepts an audio tree with extra (un-declared) labels but still requires declared ones', async () => {
    const manifest = validManifest()
    const bundle = await importDatasetZip(
      buildZip(manifest, {
        hey_studio: { 'a.wav': WAV },
        noise: { 'bg.wav': WAV },
        extra: { 'x.wav': WAV },
      }),
    )
    expect(bundle.clips.extra).toHaveLength(1)
  })

  it('round-trips contentHash: valid when matching, content-mismatch when a clip is tampered', async () => {
    const manifest = validManifest()
    const clips = clipsFixture()
    const hash = await datasetContentHash(manifest, toClipTree(clips))
    const withHash = { ...manifest, contentHash: hash }
    const bundle = await importDatasetZip(buildZip(withHash, clips))
    expect(bundle.manifest.contentHash).toBe(hash)

    // Tamper a clip -> hash no longer matches.
    const tampered = {
      hey_studio: { ...clips.hey_studio, 'a.wav': strToU8('RIFFtampered') },
      noise: clips.noise,
    }
    await expect(importDatasetZip(buildZip(withHash, tampered))).rejects.toMatchObject({
      code: 'content-mismatch',
    })
  })

  it('accepts a manifest without contentHash (producers may omit the check)', async () => {
    const bundle: DatasetBundle = await importDatasetZip(buildZip(validManifest(), clipsFixture()))
    expect(bundle.manifest.contentHash).toBeUndefined()
  })

  it('validateDatasetManifest agrees with the importer on the same object', async () => {
    const manifest = validManifest()
    expect(validateDatasetManifest(manifest).ok).toBe(true)
    const bundle = await importDatasetZip(buildZip(manifest, clipsFixture()))
    expect(bundle.manifest.id).toBe(manifest.id)
  })
})
