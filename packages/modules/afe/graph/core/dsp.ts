/**
 * AFE graph module - visualization DSP.
 *
 * The numeric cores (FFT, windows, level meters, resampling) live in the
 * platform DSP package (`@wake-studio/dsp`, ADR-032); this file keeps only
 * the AFE-specific spectrum computation and the test helpers. No dependency
 * on AudioWorkletGlobalScope - runs in Node, browser, or the worklet.
 *
 * @see docs/modules/afe.md §9 (testing strategy)
 */

import {
  createFft,
  hannSymmetric,
  levelDb,
  downsample48to16,
  downsampleForViz,
} from '@wake-studio/dsp'

/** FFT size for spectrum computation (must be power of 2, <= RNNOISE_FRAME_SIZE). */
export const FFT_SIZE = 256

/** Number of magnitude bins emitted for the spectrogram (FFT_SIZE / 4). */
export const SPECTRUM_BINS = 64

/** Pre-computed Hann window for FFT. */
export const HANN_WINDOW = hannSymmetric(FFT_SIZE)

/**
 * Compute a magnitude spectrum (SPECTRUM_BINS bins) from a frame.
 * Uses FFT_SIZE-point FFT with a Hann window. If the frame is shorter than
 * FFT_SIZE it is zero-padded (lets AEC/BSS pass the 128-sample worklet
 * quantum directly without an allocation - the spectrum will simply
 * represent a windowed, padded slice of the live signal).
 */
export function computeSpectrum(frame: Float32Array): Float32Array {
  const n = Math.min(frame.length, FFT_SIZE)
  const real = new Float32Array(FFT_SIZE)
  const imag = new Float32Array(FFT_SIZE)
  for (let i = 0; i < n; i++) {
    real[i] = frame[i] * HANN_WINDOW[i]
  }
  // Remaining bins (if any) stay 0 (zero-padding) - leaves the Hann window
  // tapering to zero at the end and keeps the FFT consistent.
  createFft(FFT_SIZE).transform(real, imag)
  const mag = new Float32Array(SPECTRUM_BINS)
  for (let i = 0; i < SPECTRUM_BINS; i++) {
    // Normalize by sqrt(FFT_SIZE), not FFT_SIZE (matches the reference
    // spectrogram implementation - spectro uses amplitude/sqrt(windowSize)).
    // With /FFT_SIZE a real room's broadband noise lands below a -60 dB
    // display floor and the spectrogram looks almost black; /sqrt(N) lifts
    // typical noise (~-43 dB) into the visible range while keeping speech
    // (~-23 dB) well separated.
    mag[i] = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]) / Math.sqrt(FFT_SIZE)
  }
  return mag
}

export { createFft, levelDb, downsample48to16, downsampleForViz }

// ---------------------------------------------------------------------------
// Test helpers (used by unit tests; not imported by the worklet)
// ---------------------------------------------------------------------------

/** Generate a sine wave at the given frequency, sample rate, and length. */
export function sineWave(
  freqHz: number,
  sampleRate: number,
  length: number,
  amplitude = 1.0,
): Float32Array {
  const out = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    out[i] = amplitude * Math.sin((2 * Math.PI * freqHz * i) / sampleRate)
  }
  return out
}

/** Generate a Float32Array filled with a constant value. */
export function constant(value: number, length: number): Float32Array {
  const out = new Float32Array(length)
  out.fill(value)
  return out
}

/** Find the index of the maximum value in a Float32Array. */
export function argMax(arr: Float32Array): number {
  let maxIdx = 0
  let maxVal = arr[0]
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] > maxVal) {
      maxVal = arr[i]
      maxIdx = i
    }
  }
  return maxIdx
}
