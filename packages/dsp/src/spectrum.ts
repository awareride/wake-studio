/**
 * Spectrum computation + test helpers (migrated from afe/graph core dsp.ts).
 *
 * `computeSpectrum` computes a magnitude spectrum (SPECTRUM_BINS bins) from a
 * frame, using a power-of-2 FFT with a Hann window. `sineWave`/`constant`/
 * `argMax` are test/benchmark helpers used across modules.
 *
 * @see ADR-032 (DSP platform package)
 */

import { createFft } from './fft'
import { hannSymmetric } from './windows'

/** Default FFT size for spectrum computation (must be power of 2). */
export const FFT_SIZE = 256

/** Number of magnitude bins emitted by `computeSpectrum` (FFT_SIZE / 4). */
export const SPECTRUM_BINS = 64

/** Pre-computed symmetric Hann window over `FFT_SIZE`. */
export const HANN_WINDOW = hannSymmetric(FFT_SIZE)

/**
 * Compute a magnitude spectrum (SPECTRUM_BINS bins) from a frame.
 * Uses FFT_SIZE-point FFT with a Hann window. If the frame is shorter than
 * FFT_SIZE it is zero-padded (lets worklet quanta shorter than the FFT pass
 * through without an allocation - the spectrum simply represents a windowed,
 * padded slice of the live signal).
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
    // With /FFT_SIZE broadband noise lands below a -60 dB display floor and
    // the spectrogram looks almost black; /sqrt(N) lifts typical noise
    // (~-43 dB) into the visible range while keeping speech (~-23 dB) well
    // separated.
    mag[i] = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]) / Math.sqrt(FFT_SIZE)
  }
  return mag
}

// ---------------------------------------------------------------------------
// Test / benchmark helpers
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
