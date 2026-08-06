/**
 * FFT core - thin, type-safe wrapper over `fft.js` (indutny, MIT).
 *
 * Why fft.js: it is the most battle-tested pure-JS radix-4 FFT available
 * (used by web-audio-js / many audio pipelines), is dependency-free, has no
 * DOM/wasm dependencies, and is fully synchronous - so it runs in any JS
 * context including an AudioWorklet. The numeric core is NOT ours; this file
 * only adapts its interleaved-complex API to the separate real/imag typed
 * arrays the rest of the codebase uses.
 *
 * The correctness contract is anchored by conformance fixtures generated from
 * scipy.fft (see tests/conformance, scripts/gen-conformance-fixtures.mjs):
 * every migration or bump of the underlying core must keep those green.
 *
 * @see ADR-032 (DSP platform package)
 */

import FFT from 'fft.js'

// fft.js ships CommonJS `export = FFT` (a constructor). Under vite/vitest's
// ESM interop the default import may be the constructor itself or an object
// with `.default`; handle both so bundler quirks don't break us.
const FftCtor: new (size: number) => {
  realTransform(out: number[], real: number[]): void
  inverseTransform(out: number[], input: number[]): void
  transform(out: number[], input: number[]): void
  completeSpectrum(spectrum: number[]): void
  createComplexArray(): number[]
} = (FFT as unknown as { default?: typeof FFT }).default ?? (FFT as unknown as typeof FFT)

// TS does not know fft.js is a constructor via default interop; keep the cast.
const Fft: new (size: number) => {
  realTransform(out: number[], real: number[]): void
  inverseTransform(out: number[], input: number[]): void
  transform(out: number[], input: number[]): void
  completeSpectrum(spectrum: number[]): void
  createComplexArray(): number[]
} = FftCtor as unknown as typeof FftCtor

/** Create an FFT engine for `size` (must be a power of 2). */
export function createFft(size: number): {
  /** Forward FFT. `real`/`imag` are Float32Array of `size`; results in place. */
  transform(real: Float32Array, imag: Float32Array): void
  /** Inverse FFT (normalized by 1/size, matching fft.js `inverseTransform`). */
  inverse(real: Float32Array, imag: Float32Array): void
  size: number
} {
  if (size <= 0 || (size & (size - 1)) !== 0) {
    throw new Error(`FFT size must be a power of 2, got ${size}`)
  }
  const fft = new Fft(size)
  // fft.js realTransform needs a real input array and a SEPARATE interleaved
  // complex output array of length 2N (it fills only the left half).
  const re = new Float32Array(size)
  const complexOut = new Float32Array(size * 2)

  return {
    transform(real, imag) {
      // realTransform expects a plain real array; copy in, transform, copy out
      // (left half only, matching fft.js semantics: bins 0..size/2).
      for (let i = 0; i < size; i++) re[i] = real[i]
      complexOut.fill(0)
      fft.realTransform(complexOut as unknown as number[], re as unknown as number[])
      const half = size / 2
      for (let k = 0; k <= half; k++) {
        real[k] = complexOut[k * 2]
        imag[k] = complexOut[k * 2 + 1]
      }
      // Mirror the conjugate-symmetric upper half (bins half+1 .. size-1).
      for (let k = half + 1; k < size; k++) {
        const kc = size - k
        real[k] = real[kc]
        imag[k] = -imag[kc]
      }
    },
    inverse(real, imag) {
      // Build interleaved complex input, mirror upper half for real IFFT.
      const complex = fft.createComplexArray()
      for (let k = 0; k <= size / 2; k++) {
        complex[k * 2] = real[k]
        complex[k * 2 + 1] = imag[k]
      }
      for (let k = size / 2 + 1; k < size; k++) {
        const kc = size - k
        complex[k * 2] = real[kc]
        complex[k * 2 + 1] = -imag[kc]
      }
      const complexOut = fft.createComplexArray()
      fft.inverseTransform(complexOut, complex)
      // inverseTransform normalizes by 1/size; copy out.
      for (let i = 0; i < size; i++) {
        real[i] = complexOut[i * 2]
        imag[i] = complexOut[i * 2 + 1]
      }
    },
    size,
  }
}

/** One-shot forward FFT on separate real/imag arrays (in place). */
export function fft(
  real: Float32Array,
  imag: Float32Array,
): { real: Float32Array; imag: Float32Array } {
  createFft(real.length).transform(real, imag)
  return { real, imag }
}

/** One-shot inverse FFT (normalized by 1/size). In place. */
export function ifft(
  real: Float32Array,
  imag: Float32Array,
): { real: Float32Array; imag: Float32Array } {
  createFft(real.length).inverse(real, imag)
  return { real, imag }
}
