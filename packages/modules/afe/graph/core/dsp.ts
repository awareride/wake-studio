/**
 * AFE module - pure DSP functions.
 *
 * Extracted from the worklet for unit testing. These functions have no
 * dependencies on AudioWorkletGlobalScope and can run in any JS environment
 * (Node, browser, AudioWorklet). See docs/modules/afe.md §9 (testing strategy).
 */

/** FFT size for spectrum computation (must be power of 2, <= RNNOISE_FRAME_SIZE). */
export const FFT_SIZE = 256

/** Number of magnitude bins emitted for the spectrogram (FFT_SIZE / 4). */
export const SPECTRUM_BINS = 64

/** Pre-computed Hann window for FFT. */
export const HANN_WINDOW = new Float32Array(FFT_SIZE)
for (let i = 0; i < FFT_SIZE; i++) {
  HANN_WINDOW[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)))
}

/** In-place radix-2 Cooley-Tukey FFT (n must be a power of 2). */
export function fft(real: Float32Array, imag: Float32Array, n: number): void {
  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[real[i], real[j]] = [real[j], real[i]]
      ;[imag[i], imag[j]] = [imag[j], imag[i]]
    }
  }
  // Butterfly.
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wR = Math.cos(ang)
    const wI = Math.sin(ang)
    const half = len >> 1
    for (let i = 0; i < n; i += len) {
      let cR = 1
      let cI = 0
      for (let j = 0; j < half; j++) {
        const uR = real[i + j]
        const uI = imag[i + j]
        const tR = real[i + j + half] * cR - imag[i + j + half] * cI
        const tI = real[i + j + half] * cI + imag[i + j + half] * cR
        real[i + j] = uR + tR
        imag[i + j] = uI + tI
        real[i + j + half] = uR - tR
        imag[i + j + half] = uI - tI
        const nR = cR * wR - cI * wI
        cI = cR * wI + cI * wR
        cR = nR
      }
    }
  }
}

/**
 * Compute RMS level in dBFS for a frame.
 * Returns -120 for near-silence (avoids -Infinity from log10(0)).
 */
export function levelDb(frame: Float32Array): number {
  let sum = 0
  for (let i = 0; i < frame.length; i++) {
    sum += frame[i] * frame[i]
  }
  const rms = Math.sqrt(sum / frame.length)
  return rms < 1e-10 ? -120 : 20 * Math.log10(rms)
}

/**
 * Downsample 48 kHz -> 16 kHz by averaging groups of 3 samples.
 * Input length must be a multiple of 3. Returns a new Float32Array.
 */
export function downsample48to16(frame480: Float32Array): Float32Array {
  const ratio = 3
  const out = new Float32Array(frame480.length / ratio)
  for (let i = 0, j = 0; i < frame480.length; i += ratio, j++) {
    let sum = 0
    for (let k = 0; k < ratio; k++) {
      sum += frame480[i + k]
    }
    out[j] = sum / ratio
  }
  return out
}

/**
 * Downsample a frame to N points for waveform display (nearest-sample pick).
 * The output has exactly `points` samples regardless of input length.
 */
export function downsampleForViz(
  frame: Float32Array,
  points: number,
): Float32Array {
  const out = new Float32Array(points)
  const step = frame.length / points
  for (let i = 0; i < points; i++) {
    out[i] = frame[Math.floor(i * step)]
  }
  return out
}

/**
 * Compute a magnitude spectrum (SPECTRUM_BINS bins) from a frame.
 * Uses FFT_SIZE-point FFT with Hann window. If the frame is shorter than
 * FFT_SIZE it is zero-padded (lets AEC/BSS pass the 128-sample worklet
 * quantum directly without an allocation - the spectrum will simply
 * represent a windowed, padded slice of the live signal).
 */
export function computeSpectrum(frame: Float32Array): Float32Array {
  const real = new Float32Array(FFT_SIZE)
  const imag = new Float32Array(FFT_SIZE)
  const n = Math.min(frame.length, FFT_SIZE)
  for (let i = 0; i < n; i++) {
    real[i] = frame[i] * HANN_WINDOW[i]
  }
  // Remaining bins (if any) stay 0 (zero-padding) - leaves the Hann window
  // tapering to zero at the end and keeps the FFT consistent.
  fft(real, imag, FFT_SIZE)
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
