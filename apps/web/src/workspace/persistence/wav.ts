/**
 * WAV encoder (epic #53 P5).
 *
 * Encodes Float32 PCM into a 16-bit PCM WAV file (the browser-supported
 * format for replay/export). Pure function — unit-testable in Node.
 */

/** Convert Float32 samples (-1..1) to 16-bit PCM WAV bytes. */
export function encodeWav(
  samples: Float32Array,
  sampleRate: number,
  channelCount = 1,
): Uint8Array {
  const numSamples = samples.length
  const bytesPerSample = 2
  const dataSize = numSamples * bytesPerSample
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  // RIFF header
  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true) // file size - 8
  writeAscii(view, 8, 'WAVE')

  // fmt chunk
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true) // fmt chunk size
  view.setUint16(20, 1, true) // PCM format
  view.setUint16(22, channelCount, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * channelCount * bytesPerSample, true) // byte rate
  view.setUint16(32, channelCount * bytesPerSample, true) // block align
  view.setUint16(34, 16, true) // bits per sample

  // data chunk
  writeAscii(view, 36, 'data')
  view.setUint32(40, dataSize, true)

  // PCM data (16-bit signed, little-endian)
  const out = new Uint8Array(buffer)
  const dv = new DataView(buffer)
  for (let i = 0; i < numSamples; i++) {
    // Clamp + scale float [-1,1] to int16.
    const s = Math.max(-1, Math.min(1, samples[i]))
    const v = s < 0 ? s * 0x8000 : s * 0x7fff
    dv.setInt16(44 + i * bytesPerSample, Math.round(v), true)
  }
  void out
  return new Uint8Array(buffer)
}

function writeAscii(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i))
  }
}

/** Trigger a client-side download of the given bytes as a .wav file. */
export function downloadWav(bytes: Uint8Array, filename: string): void {
  const blob = new Blob([bytes], { type: 'audio/wav' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  // Append so Safari fires the click, then revoke after the event loop so
  // the download has a chance to start.
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Blob URL for a WAV clip (for in-page replay). */
export function wavBlobUrl(bytes: Uint8Array): string {
  const blob = new Blob([bytes], { type: 'audio/wav' })
  return URL.createObjectURL(blob)
}

/**
 * Decode 16-bit PCM WAV bytes back to Float32 samples (-1..1).
 *
 * Inverse of `encodeWav` for the round-trip (replay waveform). Pure —
 * unit-testable in Node.
 */
export function decodeWav(bytes: Uint8Array): {
  samples: Float32Array
  sampleRate: number
  channelCount: number
} {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (readAscii(view, 0, 4) !== 'RIFF' || readAscii(view, 8, 4) !== 'WAVE') {
    throw new Error('Not a RIFF/WAVE file.')
  }

  // Walk the chunks to find 'fmt ' and 'data' (order is not guaranteed).
  let offset = 12
  let fmt: {
    channelCount: number
    sampleRate: number
    bitsPerSample: number
    format: number
  } | null = null
  let dataOffset = 0
  let dataSize = 0
  while (offset + 8 <= bytes.length) {
    const id = readAscii(view, offset, 4)
    const size = view.getUint32(offset + 4, true)
    const body = offset + 8
    if (id === 'fmt ') {
      fmt = {
        format: view.getUint16(body, true),
        channelCount: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bitsPerSample: view.getUint16(body + 14, true),
      }
    } else if (id === 'data') {
      dataOffset = body
      dataSize = size
    }
    // Chunks are 2-byte aligned.
    offset = body + size + (size % 2)
  }

  if (!fmt) throw new Error('Missing fmt chunk.')
  if (fmt.format !== 1) throw new Error('Only PCM WAV is supported.')
  if (fmt.bitsPerSample !== 16) {
    throw new Error(`Unsupported bits per sample: ${fmt.bitsPerSample}`)
  }
  if (dataSize === 0) return { samples: new Float32Array(0), sampleRate: fmt.sampleRate, channelCount: fmt.channelCount }

  const frameCount = Math.floor(dataSize / (fmt.channelCount * 2))
  const samples = new Float32Array(frameCount)
  const dv = new DataView(bytes.buffer, bytes.byteOffset + dataOffset, dataSize)
  for (let i = 0; i < frameCount; i++) {
    // Mono decode: use channel 0 of each frame (encoder writes mono).
    const v = dv.getInt16(i * fmt.channelCount * 2, true)
    samples[i] = v / (v < 0 ? 0x8000 : 0x7fff)
  }
  return { samples, sampleRate: fmt.sampleRate, channelCount: fmt.channelCount }
}

function readAscii(view: DataView, offset: number, len: number): string {
  let s = ''
  for (let i = 0; i < len; i++) {
    s += String.fromCharCode(view.getUint8(offset + i))
  }
  return s
}
