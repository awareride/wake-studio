/**
 * File input source (epic #53 P3).
 *
 * Decodes audio files via `AudioContext.decodeAudioData` (browser-supported
 * formats: wav/mp3/ogg/flac) and schedules them with the FileScheduler:
 * multiple files play concurrently (mixed, confirmed decision 2026-08-07), each
 * channel with its own loop + offset. The scheduler's output feeds the AFE
 * worklet (mono mix), and the worklet's existing downsample48to16 produces the
 * 16 kHz KWS stream — no new DSP needed.
 *
 * The decoded AudioBuffer is created from an ArrayBuffer with explicit
 * sample-rate hints (decodeAudioData resamples to the context rate).
 */

import type { FileChannelConfig } from '../types'

/** A decoded, schedulable file (mirrors FileSourceItem minus the object URL
 *  lifecycle, which the scheduler owns). */
export interface DecodedFile {
  /** File source item id (matches the workspace config entry). */
  id: string
  name: string
  /** Decoded PCM (48 kHz after decodeAudioData in the pipeline context). */
  buffer: AudioBuffer
  /** Original sample rate (e.g. 44100 / 48000). */
  sampleRate: number
  /** Duration in ms. */
  durationMs: number
  /** Number of channels (from AudioBuffer.numberOfChannels). */
  channelCount: number
}

/**
 * Decode one audio File into a DecodedFile. Uses a shared AudioContext so
 * multiple files share one decode path. Throws when the file is not decodable.
 */
export async function decodeAudioFile(
  file: File,
  ctx: AudioContext,
): Promise<DecodedFile> {
  const arrayBuffer = await file.arrayBuffer()
  const audioBuffer = await ctx.decodeAudioData(arrayBuffer)
  return {
    id: `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: file.name,
    buffer: audioBuffer,
    sampleRate: audioBuffer.sampleRate,
    durationMs: Math.round((audioBuffer.duration || 0) * 1000),
    channelCount: audioBuffer.numberOfChannels,
  }
}

/**
 * Schedule decoded files for concurrent playback with per-channel loop +
 * offset. Builds one AudioBufferSourceNode per active channel and mixes them
 * (mono) through a gain node; `node` is what the AFE pipeline wires in.
 */
export class FileScheduler {
  /** The mono mix output to connect into the pipeline. */
  readonly output: GainNode
  private _ctx: AudioContext
  private _sources: AudioBufferSourceNode[] = []
  private _started = false
  /** Whether dispose() should close the AudioContext (owned by this
   *  scheduler, e.g. the buildFileScheduler path). */
  private _ownsCtx: boolean

  constructor(ctx: AudioContext, ownsCtx = true) {
    this._ctx = ctx
    this._ownsCtx = ownsCtx
    this.output = ctx.createGain()
    // Mix to mono: the pipeline worklet reads inputs[0][0]; a 1-channel gain
    // node guarantees channel 0 is the sum.
    this.output.channelCount = 1
    this.output.channelCountMode = 'explicit'
    this.output.channelInterpretation = 'speakers'
  }

  /**
   * Build + start the source nodes for one decoded file's channels.
   * Call once per file; files play concurrently. `offsetMs` is per channel.
   */
  addFile(file: DecodedFile, channels: FileChannelConfig[]): void {
    const when = this._ctx.currentTime + 0.05 // slight stagger so all start together
    for (const ch of channels) {
      const src = this._ctx.createBufferSource()
      src.buffer = file.buffer
      // Select the channel: bufferSource plays all channels by default, so
      // route through a per-channel gain with explicit channel count + an
      // offset into the buffer via `start(when, offset)`.
      const channelGain = this._ctx.createGain()
      channelGain.channelCount = 1
      channelGain.channelCountMode = 'explicit'
      channelGain.channelInterpretation = 'speakers'

      src.loop = ch.loop
      // BufferSource's loop with offset: start at offsetMs; loop restarts at
      // the offset each cycle (per-channel offset semantics).
      const offset = Math.min(
        Math.max(0, ch.offsetMs / 1000),
        file.buffer.duration,
      )
      // For multi-channel buffers, extract the target channel by connecting
      // through a per-channel gain with explicit channel count (downmix). To
      // loop channel N independently we build a mono buffer with that
      // channel only (via the context, which exists in the browser).
      const channelBuffer = extractChannel(this._ctx, file.buffer, ch.index)
      src.buffer = channelBuffer

      src.connect(channelGain)
      channelGain.connect(this.output)
      src.start(when, offset, ch.loop ? undefined : file.buffer.duration - offset)

      this._sources.push(src)
    }
    this._started = true
  }

  /** Stop all sources and disconnect the output. */
  dispose(): void {
    for (const s of this._sources) {
      try {
        s.stop()
      } catch {
        // Already stopped.
      }
      try {
        s.disconnect()
      } catch {
        // Already disconnected.
      }
    }
    this._sources = []
    try {
      this.output.disconnect()
    } catch {
      // Already disconnected.
    }
    if (this._ownsCtx) {
      void this._ctx.close().catch(() => {})
    }
    this._started = false
  }

  get started(): boolean {
    return this._started
  }
}

/**
 * Build a mono AudioBuffer containing only channel `index` of the source
 * buffer (so a stereo file's left channel can loop independently of the
 * right). Uses the context's createBuffer (Node tests stub it). If the index
 * is out of range, falls back to a downmix of the whole buffer.
 */
function extractChannel(ctx: AudioContext, buffer: AudioBuffer, index: number): AudioBuffer {
  if (buffer.numberOfChannels === 1 || index >= buffer.numberOfChannels) {
    return buffer
  }
  const data = buffer.getChannelData(index)
  const mono = ctx.createBuffer(1, buffer.length, buffer.sampleRate)
  mono.copyToChannel(data, 0)
  return mono
}
