/**
 * Spectrogram column generation (Spectro-style, ADR-032).
 *
 * Generates a single FFT column for a real-time scrolling spectrogram, ported
 * from the reference Spectro visualizer
 * (https://github.com/calebj0seph/spectro - MIT):
 *
 *   - Frames of `windowSize` samples (default 4096) are windowed with the
 *     seven-term Blackman-Harris window and run through an FFT.
 *   - The magnitude of each bin is normalized by `sqrt(windowSize)` (NOT
 *     `windowSize`) - this lifts typical ambient noise into the visible range
 *     of the renderer's color ramp while keeping speech well separated.
 *   - Columns are produced at a fixed `columnStep` cadence from the most
 *     recent samples (streaming mode), so a live worklet can emit one column
 *     per visualization frame without buffering a full window.
 *
 * Unlike the reference's batch `generateSpectrogram`, this emits a single
 * column (newest `windowSize` samples) and leaves the time-axis history to the
 * renderer's circular texture - the exact split the live AFE worklet needs.
 */

import { createFft } from './fft'
import { blackmanHarris7 } from './windows'

/** Default FFT window size in samples (~85 ms @ 48 kHz). */
export const SPECTROGRAM_WINDOW_SIZE = 4096

/** Default hop between FFT windows (4x overlap, Spectro default). */
export const SPECTROGRAM_WINDOW_STEP = 1024

/** Number of magnitude bins per column = windowSize / 2. */
export const SPECTROGRAM_BINS = SPECTROGRAM_WINDOW_SIZE / 2

/** Pre-computed 7-term Blackman-Harris window (Spectro default). */
export const SPECTROGRAM_WINDOW = blackmanHarris7(SPECTROGRAM_WINDOW_SIZE)

export interface SpectrogramColumnOptions {
  /** FFT window size in samples. Must be a power of 2. Default 4096. */
  windowSize?: number
  /** Sample rate (Hz) used only for metadata; does not change the FFT. */
  sampleRate?: number
}

/**
 * Compute a single magnitude-spectrogram column from the most recent
 * `windowSize` samples of `frame` (zero-padded if shorter).
 *
 * The column is laid out with bin 0 (DC / lowest frequency) at index 0 and the
 * Nyquist bin at index windowSize/2 - 1, matching the renderer's frequency
 * axis (which maps canvas rows to bins via the selected scale).
 *
 * @returns the magnitude column (length windowSize/2), plus the actual window
 *   size and sample rate used (the renderer needs them to map Hz -> bins).
 */
export function spectrogramColumn(
  frame: Float32Array,
  opts: SpectrogramColumnOptions = {},
): { column: Float32Array; windowSize: number; sampleRate: number } {
  const windowSize = opts.windowSize ?? SPECTROGRAM_WINDOW_SIZE
  if (windowSize <= 0 || (windowSize & (windowSize - 1)) !== 0) {
    throw new Error(`spectrogram windowSize must be a power of 2, got ${windowSize}`)
  }
  const sampleRate = opts.sampleRate ?? 48000

  // Pre-compute the window for this size (cached per size).
  const window = getWindow(windowSize)
  const real = new Float32Array(windowSize)
  const imag = new Float32Array(windowSize)
  const n = Math.min(frame.length, windowSize)
  for (let i = 0; i < n; i++) {
    real[i] = frame[i] * window[i]
  }
  // Remaining samples stay 0 (zero-padding) - the window already tapers to
  // near zero at both ends, so this matches a centered-window FFT closely.

  const fft = createFft(windowSize)
  fft.transform(real, imag)

  const bins = windowSize / 2
  const column = new Float32Array(bins)
  const invSqrtN = 1 / Math.sqrt(windowSize)
  for (let k = 0; k < bins; k++) {
    column[k] = Math.sqrt(real[k] * real[k] + imag[k] * imag[k]) * invSqrtN
  }
  return { column, windowSize, sampleRate }
}

// ---------------------------------------------------------------------------
// Per-size window cache (only ever a handful of sizes).
// ---------------------------------------------------------------------------

const windowCache = new Map<number, Float32Array>()

function getWindow(size: number): Float32Array {
  let w = windowCache.get(size)
  if (!w) {
    w = blackmanHarris7(size)
    windowCache.set(size, w)
  }
  return w
}
