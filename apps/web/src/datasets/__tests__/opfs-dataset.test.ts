/**
 * Datasets — OPFS archive store (ADR-045 #220).
 *
 * With in-memory fake handles (see `fake-opfs.ts`): write a canonical
 * `wake-studio-dataset.zip` to OPFS, list its `audio/<label>/*.wav` clips from
 * the central-directory tail, read ONE clip byte-exact, and delete. The
 * archives are produced by the real `assembleDatasetZip`, so the reads are
 * exercised against the exact layout the pipeline writes.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import {
  assembleDatasetZip,
  buildGeneratedManifest,
  pcmToWav,
} from '@wake-studio/module-dataset'
import {
  DatasetStorageError,
  deleteDatasetZip,
  getDatasetRoot,
  listDatasetClips,
  readDatasetClipBytes,
  readDatasetZipBytes,
  writeDatasetZip,
} from '../browser/opfs-dataset'
import { makeFakeOpfsRoot, type FakeDirectoryHandle } from './fake-opfs'

function wavOf(byte: number): Uint8Array {
  const pcm = new Uint8Array(64)
  for (let i = 0; i < pcm.length; i += 2) pcm[i] = byte
  return pcmToWav(pcm, 16000)
}

async function makeCanonicalArchive(): Promise<Uint8Array> {
  const manifest = buildGeneratedManifest(
    { engine: 'mimo-tts', phrases: ['hey buddy', 'good night'], languages: ['en-US'], samplesPerPhrase: 2 },
    [
      { name: 'hey buddy', role: 'positive' },
      { name: 'good night', role: 'positive' },
    ],
    4,
    1234,
  )
  const clips: Record<string, Array<{ name: string; bytes: Uint8Array }>> = {
    hey_buddy: [
      { name: '0001.wav', bytes: wavOf(0x11) },
      { name: '0002.wav', bytes: wavOf(0x22) },
    ],
    good_night: [
      { name: '0001.wav', bytes: wavOf(0x33) },
      { name: '0002.wav', bytes: wavOf(0x44) },
    ],
  }
  return (await assembleDatasetZip(manifest, clips)).zipBytes
}

describe('OPFS dataset store', () => {
  let root: FakeDirectoryHandle

  const seed = async () => {
    const bytes = await makeCanonicalArchive()
    await writeDatasetZip('ds-1', bytes, root as unknown as FileSystemDirectoryHandle)
    return bytes
  }

  beforeEach(() => {
    root = makeFakeOpfsRoot()
  })

  it('writes + reads back the archive byte-exact', async () => {
    const bytes = await seed()
    const got = await readDatasetZipBytes('ds-1', root as unknown as FileSystemDirectoryHandle)
    expect(got).not.toBeNull()
    expect([...got!]).toEqual([...bytes])
  })

  it('lists the audio/<label>/*.wav tree from the archive tail', async () => {
    await seed()
    const clips = await listDatasetClips('ds-1', root as unknown as FileSystemDirectoryHandle)
    expect(clips.map((c) => c.path).sort()).toEqual([
      'audio/good_night/0001.wav',
      'audio/good_night/0002.wav',
      'audio/hey_buddy/0001.wav',
      'audio/hey_buddy/0002.wav',
    ])
    expect(clips[0]).toMatchObject({ label: 'good_night', name: '0001.wav' })
  })

  it('reads ONE clip byte-exact (bounded single-entry read)', async () => {
    await seed()
    const got = await readDatasetClipBytes(
      'ds-1',
      'audio/hey_buddy/0002.wav',
      root as unknown as FileSystemDirectoryHandle,
    )
    expect([...got]).toEqual([...wavOf(0x22)])
  })

  it('throws a clear error for a missing clip', async () => {
    await seed()
    await expect(
      readDatasetClipBytes('ds-1', 'audio/nope/0001.wav', root as unknown as FileSystemDirectoryHandle),
    ).rejects.toThrow(DatasetStorageError)
  })

  it('lists empty + throws on reads for an absent dataset', async () => {
    expect(await listDatasetClips('missing', root as unknown as FileSystemDirectoryHandle)).toEqual([])
    expect(await readDatasetZipBytes('missing', root as unknown as FileSystemDirectoryHandle)).toBeNull()
    await expect(
      readDatasetClipBytes('missing', 'audio/x/1.wav', root as unknown as FileSystemDirectoryHandle),
    ).rejects.toThrow(DatasetStorageError)
  })

  it('deleteDatasetZip removes the whole datasets/<id>/ dir', async () => {
    await seed()
    await deleteDatasetZip('ds-1', root as unknown as FileSystemDirectoryHandle)
    expect(await readDatasetZipBytes('ds-1', root as unknown as FileSystemDirectoryHandle)).toBeNull()
    // Delete is idempotent.
    await expect(deleteDatasetZip('ds-1', root as unknown as FileSystemDirectoryHandle)).resolves.toBeUndefined()
  })

  it('getDatasetRoot throws a clear error when OPFS is unavailable (Node has no navigator)', async () => {
    await expect(getDatasetRoot()).rejects.toThrow(/OPFS/)
  })
})