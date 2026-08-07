/**
 * Clip store unit tests (epic #53 P5).
 *
 * Tests the pure clip-building logic (buildClip: metadata + WAV blob). The
 * IndexedDB layer itself needs a browser and is covered by the e2e run;
 * saveClip/listClips/deleteClip are thin wrappers over IDB.
 */

import { describe, it, expect } from 'vitest'
import { buildClip, type SavedClip } from '../persistence/clipStore'
import { decodeWav } from '../persistence/wav'

describe('buildClip', () => {
  it('produces a WAV blob with matching metadata', async () => {
    const samples = new Float32Array(4800).fill(0.25)
    const clip: SavedClip = buildClip('ns', samples, 48000, 'proj-1', 'ns-1')

    expect(clip.stageId).toBe('ns')
    expect(clip.projectId).toBe('proj-1')
    expect(clip.name).toBe('ns-1')
    expect(clip.durationMs).toBe(100) // 4800 / 48000 * 1000
    expect(clip.sampleRate).toBe(48000)
    expect(clip.id).toBeTruthy()
    expect(clip.createdAtMs).toBeGreaterThan(0)
    expect(clip.blob.type).toBe('audio/wav')

    // The stored blob must decode back to the captured audio.
    const bytes = new Uint8Array(await clip.blob.arrayBuffer())
    const { samples: decoded, sampleRate } = decodeWav(bytes)
    expect(sampleRate).toBe(48000)
    expect(decoded.length).toBe(samples.length)
  })

  it('defaults the clip name when omitted', () => {
    const clip = buildClip('kws', new Float32Array(1600), 16000)
    expect(clip.name).toMatch(/^clip-kws-/)
    expect(clip.durationMs).toBe(100)
    expect(clip.projectId).toBeUndefined()
  })
})
