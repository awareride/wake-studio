/**
 * STFT / ISTFT - frame framing, windowing, and (optionally) overlap-add
 * reconstruction. Pure TS, no DOM/wasm (AudioWorklet-safe).
 *
 * Convention (matches scipy.signal.stft and torch.stft defaults used by the
 * conformance fixtures):
 *   - `center=false` for exact frame-aligned STFT (scipy's `boundary=None`,
 *     torch's `center=False`).
 *   - Frames are `[start, start+nfft)`; windows are periodic.
 *
 * @see ADR-032 (DSP platform package)
 */

import { createFft } from './fft'
import { hannPeriodic } from './windows'

export interface StftOptions {
  /** FFT size. Must be a power of 2. Defaults to `window.length`. */
  nfft?: number
  /** Hop between frames in samples. Must be > 0. Defaults to `nfft / 4`. */
  hop?: number
  /**
   * Frame (window) length in samples, when it differs from `nfft`. When set,
   * frames are `[start, start + frameLen)`, zero-padded to `nfft` for the FFT
   * (this is the torchaudio/PLiX convention: win=400, nfft=1024). Defaults to
   * `nfft` (full-frame FFT, the scipy convention).
   */
  frameLen?: number
  /**
   * If true, emit magnitude (real) only; if false (default), emit complex
   * spectrum as interleaved [re, im] pairs (matches ONNX STFT layout).
   */
  magnitude?: boolean
  /**
   * When `magnitude: true`, skip the 1/sum(window) amplitude normalization
   * (scipy.signal.stft convention) and emit raw |FFT|. Used by the mel
   * front-end, which must match the PLiX/torchaudio reference exactly.
   */
  rawMagnitude?: boolean
  /** Window to apply per frame. Defaults to a periodic Hann of `nfft`. */
  window?: Float32Array
}

export interface StftResult {
  /** [frames, nfft/2 + 1] magnitude or [frames, nfft/2 + 1, 2] complex. */
  data: Float32Array
  frames: number
  bins: number
  nfft: number
  hop: number
  frameLen: number
  window: Float32Array
}

/**
 * Compute the STFT of a mono signal.
 *
 * - If `magnitude: true`, returns a [frames, bins] magnitude matrix (power
 *   spectrum: sqrt(re^2 + im^2)), which is what melSpectrogram consumes.
 * - If `magnitude` is omitted/false, returns a [frames, bins, 2] complex
 *   matrix (interleaved re/im), which is what ISTFT consumes and what matches
 *   ONNX STFT's output layout.
 *
 * Frames are the largest count whose frame start satisfies
 * `start + nfft <= signal.length` (exact framing; no trailing partial frame).
 */
export function stft(signal: Float32Array, opts: StftOptions = {}): StftResult {
  const nfft = opts.nfft ?? opts.window?.length ?? 1024
  const frameLen = opts.frameLen ?? nfft
  const hop = opts.hop ?? Math.floor(frameLen / 4)
  const window = opts.window ?? hannPeriodic(frameLen)
  if (nfft <= 0 || (nfft & (nfft - 1)) !== 0) throw new Error(`nfft must be a power of 2, got ${nfft}`)
  if (frameLen > nfft) throw new Error(`frameLen (${frameLen}) must be <= nfft (${nfft})`)
  if (hop <= 0) throw new Error(`hop must be > 0, got ${hop}`)

  // Frames are aligned by `frameLen`; the FFT zero-pads to `nfft`.
  const frames = Math.floor((signal.length - frameLen) / hop) + 1
  if (frames <= 0) throw new Error(`signal too short for frameLen=${frameLen}`)

  const bins = nfft / 2 + 1
  const engine = createFft(nfft)
  const re = new Float32Array(nfft)
  const im = new Float32Array(nfft)
  const magMode = opts.magnitude === true

  // Match scipy.signal.stft's amplitude convention: divide by the window sum
  // so |Zxx| is the amplitude spectrum (this is what melSpectrogram and
  // visualization expect; the conformance fixture pins it). Skip with
  // `rawMagnitude` (mel front-end matches the PLiX reference exactly).
  let winSum = 0
  for (let i = 0; i < window.length; i++) winSum += window[i]
  const norm = magMode && !opts.rawMagnitude ? 1 / Math.max(1e-10, winSum) : 1

  const data = new Float32Array(magMode ? frames * bins : frames * bins * 2)
  for (let f = 0; f < frames; f++) {
    const start = f * hop
    re.fill(0)
    im.fill(0)
    for (let i = 0; i < frameLen; i++) re[i] = (signal[start + i] || 0) * window[i]
    engine.transform(re, im)
    if (magMode) {
      const base = f * bins
      for (let k = 0; k < bins; k++) {
        const r = re[k]
        const i = im[k]
        data[base + k] = Math.sqrt(r * r + i * i) * norm
      }
    } else {
      const base = f * bins * 2
      for (let k = 0; k < bins; k++) {
        data[base + k * 2] = re[k]
        data[base + k * 2 + 1] = im[k]
      }
    }
  }
  return { data, frames, bins, nfft, hop, frameLen, window }
}

/**
 * Inverse STFT by overlap-add (magnitude of the original signal is NOT
 * recoverable - ISTFT requires the complex spectrum). This is provided for
 * future AEC/BSS work where phase is available. Mirrors scipy.signal.istft.
 */
export function istft(
  complexData: Float32Array,
  opts: { nfft: number; hop: number; frames: number; signalLength?: number; window?: Float32Array },
): Float32Array {
  const { nfft, hop, frames } = opts
  const window = opts.window ?? hannPeriodic(nfft)
  const signalLength = opts.signalLength ?? ((frames - 1) * hop + nfft)
  const out = new Float32Array(signalLength)
  const norm = new Float32Array(signalLength)
  const re = new Float32Array(nfft)
  const im = new Float32Array(nfft)
  const engine = createFft(nfft)

  for (let f = 0; f < frames; f++) {
    const start = f * hop
    const base = f * nfft * 2
    for (let k = 0; k < nfft / 2 + 1; k++) {
      re[k] = complexData[base + k * 2]
      im[k] = complexData[base + k * 2 + 1]
    }
    // Mirror upper bins (conjugate symmetry) for real IFFT.
    for (let k = nfft / 2 + 1; k < nfft; k++) {
      const kc = nfft - k
      re[k] = complexData[base + kc * 2]
      im[k] = -complexData[base + kc * 2 + 1]
    }
    engine.inverse(re, im)
    // fft.js inverseTransform is unnormalized: divide by nfft here.
    for (let i = 0; i < nfft; i++) {
      const idx = start + i
      if (idx < signalLength) {
        out[idx] += (re[i] / nfft) * window[i]
        norm[idx] += window[i] * window[i]
      }
    }
  }
  for (let i = 0; i < signalLength; i++) {
    if (norm[i] > 1e-10) out[i] /= norm[i]
  }
  return out
}
