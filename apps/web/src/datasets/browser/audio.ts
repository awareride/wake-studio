/**
 * Datasets — browser audio pipeline (ADR-044 §8.1, #208).
 *
 * Converts raw TTS output (headerless pcm16, wav, or anything
 * AudioContext.decodeAudioData accepts — mp3, ogg…) into the CANONICAL
 * 16 kHz mono PCM WAV via Web Audio (OfflineAudioContext). No ffmpeg needed —
 * a browser advantage over the backend path. Browser-only (Web Audio API);
 * the pure PCM→WAV container encoding lives in the L1-tested core module.
 */

import { isWavBytes, pcmToWav, CANONICAL_SAMPLE_RATE } from '@wake-studio/module-dataset'

export class AudioPipelineError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AudioPipelineError'
  }
}

/** Decode audio bytes into an AudioBuffer (promise-form with callback
 *  fallback for older browsers). */
async function decode(buffer: ArrayBuffer): Promise<AudioBuffer> {
  const Ctx: typeof OfflineAudioContext = window.OfflineAudioContext ?? window.AudioContext
  const ctx = new Ctx(1, 1, CANONICAL_SAMPLE_RATE)
  try {
    const decoded = await ctx.decodeAudioData(buffer)
    return decoded
  } catch (err) {
    throw new AudioPipelineError(
      `could not decode the TTS audio (unsupported format or corrupt bytes) — ` +
        `${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

/** Encode a Float32 channel as 16-bit signed PCM (interleaved mono). */
function float32ToPcm16(samples: Float32Array): Uint8Array {
  const out = new Uint8Array(samples.length * 2)
  const view = new DataView(out.buffer)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return out
}

/** Convert raw TTS bytes into the canonical 16 kHz mono PCM WAV.
 *
 * Headerless pcm16 is wrapped at `sampleRate` first (the backend trusts the
 * same param); wav/other formats are decoded by Web Audio which reads their
 * real header, then everything is resampled to 16 kHz mono.
 */
export async function toCanonicalWav(
  audioBytes: Uint8Array,
  sampleRate = CANONICAL_SAMPLE_RATE,
): Promise<Uint8Array> {
  let source = audioBytes
  if (!isWavBytes(audioBytes)) {
    // Headerless PCM (pcm16): wrap at the configured rate so Web Audio can
    // decode + resample it (mirrors the backend's `pcm_to_wav` trust).
    source = pcmToWav(audioBytes, sampleRate, 1)
  }

  // Copy into a fresh buffer (Safari requires ArrayBuffer; Uint8Array shares).
  const copy = source.slice().buffer
  const buf = await decode(copy)

  if (buf.sampleRate === CANONICAL_SAMPLE_RATE && buf.numberOfChannels === 1) {
    return pcmToWav(float32ToPcm16(buf.getChannelData(0)), CANONICAL_SAMPLE_RATE, 1)
  }

  // Resample (any rate / channels) to 16 kHz mono via OfflineAudioContext.
  const length = Math.ceil(buf.duration * CANONICAL_SAMPLE_RATE)
  const ctx = new OfflineAudioContext(1, length, CANONICAL_SAMPLE_RATE)
  const src = ctx.createBufferSource()
  src.buffer = buf
  src.connect(ctx.destination)
  src.start(0)
  const rendered = await ctx.startRendering()
  return pcmToWav(float32ToPcm16(rendered.getChannelData(0)), CANONICAL_SAMPLE_RATE, 1)
}

/** Synthesize a deterministic silence WAV (keeps augmentation happy). */
export { writeSilenceWav } from '@wake-studio/module-dataset'
