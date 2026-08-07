/**
 * WAV encoder/decoder unit tests (epic #53 P5).
 *
 * The WAV codec is the persistence workhorse (export to disk + replay), so
 * header layout, clamping and the encode->decode round trip are pinned here.
 */

import { describe, it, expect } from 'vitest'
import { encodeWav, decodeWav } from '../persistence/wav'

function ascii(view: DataView, offset: number, len: number): string {
  let s = ''
  for (let i = 0; i < len; i++) s += String.fromCharCode(view.getUint8(offset + i))
  return s
}

describe('encodeWav', () => {
  it('writes a valid 16-bit PCM RIFF/WAVE header', () => {
    const bytes = encodeWav(new Float32Array([0, 0.5, -0.5]), 48000)
    const view = new DataView(bytes.buffer)

    expect(ascii(view, 0, 4)).toBe('RIFF')
    expect(ascii(view, 8, 4)).toBe('WAVE')
    expect(ascii(view, 12, 4)).toBe('fmt ')
    expect(view.getUint16(20, true)).toBe(1) // PCM
    expect(view.getUint16(22, true)).toBe(1) // mono
    expect(view.getUint32(24, true)).toBe(48000)
    expect(view.getUint16(34, true)).toBe(16) // bits per sample
    expect(ascii(view, 36, 4)).toBe('data')

    // 44 header bytes + 3 samples * 2 bytes.
    expect(bytes.length).toBe(44 + 6)
    expect(view.getUint32(40, true)).toBe(6) // data chunk size
  })

  it('clamps samples to [-1, 1] and quantizes to int16', () => {
    const bytes = encodeWav(new Float32Array([2, -2, 0]), 16000)
    const view = new DataView(bytes.buffer)
    expect(view.getInt16(44, true)).toBe(0x7fff)
    expect(view.getInt16(46, true)).toBe(-0x8000)
    expect(view.getInt16(48, true)).toBe(0)
  })
})

describe('decodeWav', () => {
  it('round-trips encode -> decode within int16 quantization', () => {
    const input = new Float32Array(1000)
    for (let i = 0; i < input.length; i++) {
      input[i] = Math.sin(i * 0.05) * 0.9
    }
    const bytes = encodeWav(input, 48000)
    const { samples, sampleRate, channelCount } = decodeWav(bytes)

    expect(sampleRate).toBe(48000)
    expect(channelCount).toBe(1)
    expect(samples.length).toBe(input.length)
    for (let i = 0; i < input.length; i++) {
      // int16 rounding error is at most 1/32767 per sample.
      expect(Math.abs(samples[i] - input[i])).toBeLessThanOrEqual(1 / 32767 + 1e-9)
    }
  })

  it('rejects non-WAV bytes', () => {
    expect(() => decodeWav(new Uint8Array(64))).toThrow()
  })

  it('decodes an empty clip', () => {
    const { samples, sampleRate } = decodeWav(encodeWav(new Float32Array(0), 8000))
    expect(samples.length).toBe(0)
    expect(sampleRate).toBe(8000)
  })
})
