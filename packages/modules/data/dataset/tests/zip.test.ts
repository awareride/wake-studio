/**
 * Dataset module — canonical archive readers (ADR-045, #220).
 *
 * Pure + L1: list + single-entry extraction on the canonical
 * `wake-studio-dataset.zip` (as produced by `assembleDatasetZip`). The tests
 * cover both convenience paths (whole-archive `listZipEntries` /
 * `extractZipEntry`) and the slice path the browser listener uses
 * (`findZipEnd` → `parseCentralDirectory` → `extractZipEntrySlice` on a tail +
 * exact entry slice).
 */

import { describe, expect, it } from 'vitest'
import { strToU8, zipSync, unzipSync, strFromU8 } from 'fflate'
import {
  findZipEnd,
  parseCentralDirectory,
  listZipEntries,
  extractZipEntry,
  extractZipEntrySlice,
  ZIP_EOCD_MAX_COMMENT,
} from '../core/zip'
import {
  assembleDatasetZip,
  buildGeneratedManifest,
  pcmToWav,
} from '../core/generate'

function wavOf(sample: number): Uint8Array {
  const pcm = new Uint8Array(160); // 80 samples at 16 kHz = 5 ms
  for (let i = 0; i < pcm.length; i += 2) pcm[i] = sample & 0xff
  return pcmToWav(pcm, 16000)
}

async function makeCanonicalArchive(): Promise<Uint8Array> {
  const manifest = buildGeneratedManifest(
    { engine: 'mimo-tts', phrases: ['hey studio', 'good morning'], languages: ['en-US'], samplesPerPhrase: 2 },
    [
      { name: 'hey studio', role: 'positive' },
      { name: 'good morning', role: 'positive' },
    ],
    4,
    1234,
  )
  const clips: Record<string, Array<{ name: string; bytes: Uint8Array }>> = {
    hey_studio: [
      { name: '0001.wav', bytes: wavOf(0x12) },
      { name: '0002.wav', bytes: wavOf(0x34) },
    ],
    good_morning: [
      { name: '0001.wav', bytes: wavOf(0x56) },
      { name: '0002.wav', bytes: wavOf(0x78) },
    ],
  }
  const { zipBytes } = await assembleDatasetZip(manifest, clips)
  return zipBytes
}

describe('findZipEnd', () => {
  it('locates the EOCD in the tail of a real canonical archive', async () => {
    const archive = await makeCanonicalArchive()
    const end = findZipEnd(archive)
    expect(end.totalEntries).toBe(5) // dataset.json + 4 audio clips
    expect(end.cdOffset).toBeGreaterThan(0)
    expect(end.cdSize).toBeGreaterThan(0)
  })

  it('works on a bounded tail slice (as read off an OPFS file)', async () => {
    const archive = await makeCanonicalArchive()
    const tail = archive.slice(Math.max(0, archive.length - (22 + ZIP_EOCD_MAX_COMMENT)))
    const end = findZipEnd(new Uint8Array(tail))
    expect(end.totalEntries).toBe(5)
  })

  it('throws on bytes that are not a zip', () => {
    expect(() => findZipEnd(new Uint8Array([1, 2, 3]))).toThrow(/zip/)
  })
})

describe('listZipEntries', () => {
  it('lists dataset.json + the audio/<label>/<file>.wav tree', async () => {
    const archive = await makeCanonicalArchive()
    const entries = listZipEntries(archive)
    const names = entries.map((e) => e.name).sort()
    expect(names).toEqual([
      'audio/good_morning/0001.wav',
      'audio/good_morning/0002.wav',
      'audio/hey_studio/0001.wav',
      'audio/hey_studio/0002.wav',
      'dataset.json',
    ])
    expect(entries.every((e) => e.method === 8)).toBe(true) // fflate zipSync = deflate
  })
})

describe('extractZipEntry', () => {
  it('extracts a single audio clip byte-exact without a full unzip', async () => {
    const archive = await makeCanonicalArchive()
    const expected = wavOf(0x12)
    const got = extractZipEntry(archive, 'audio/hey_studio/0001.wav')
    expect(got).toBeDefined()
    expect([...got!]).toEqual([...expected])
  })

  it('extracts dataset.json as UTF-8 text', async () => {
    const archive = await makeCanonicalArchive()
    const got = extractZipEntry(archive, 'dataset.json')!
    const parsed = JSON.parse(strFromU8(got)) as { name: string; audio: { clips: number } }
    expect(parsed.name).toBe('hey_studio-en-US')
    expect(parsed.audio.clips).toBe(4)
  })

  it('returns undefined for a missing entry', async () => {
    const archive = await makeCanonicalArchive()
    expect(extractZipEntry(archive, 'audio/nope/0001.wav')).toBeUndefined()
  })
})

describe('extractZipEntrySlice (the browser file-slice path)', () => {
  it('reassembles the exact clip from tail + central dir + one slice', async () => {
    const archive = await makeCanonicalArchive()
    // Bind the entry info exactly like the OPFS listener would...
    const tail = new Uint8Array(archive.slice(Math.max(0, archive.length - (22 + ZIP_EOCD_MAX_COMMENT))))
    const end = findZipEnd(tail)
    const cd = new Uint8Array(archive.slice(end.cdOffset, end.cdOffset + end.cdSize))
    const entries = parseCentralDirectory(cd, end.totalEntries)
    const clip = entries.find((e) => e.name === 'audio/hey_studio/0002.wav')!
    expect(clip).toBeDefined()
    // ...then inflate only the one local entry:
    const slice = new Uint8Array(archive.slice(clip.localHeaderOffset))
    const got = extractZipEntrySlice(slice)
    expect([...got]).toEqual([...wavOf(0x34)])
  })

  it('handles stored (method 0) entries', () => {
    const bytes = strToU8('stored-bytes')
    const archive = zipSync({
      'a.bin': [bytes, { level: 0 }], // level 0 = stored, no deflate
    })
    const entry = listZipEntries(archive)[0]
    expect(entry.method).toBe(0)
    expect(strFromU8(extractZipEntry(archive, 'a.bin')!)).toBe('stored-bytes')
  })
})

describe('interop with fflate unzipSync (ground truth)', () => {
  it('reproduces the same bytes as a full unzip', async () => {
    const archive = await makeCanonicalArchive()
    const full = unzipSync(archive)
    for (const name of Object.keys(full)) {
      expect([...(extractZipEntry(archive, name) ?? [])]).toEqual([...full[name]])
    }
  })
})