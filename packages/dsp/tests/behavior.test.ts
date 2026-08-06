/**
 * Behavioral unit tests for @wake-studio/dsp (migrated from afe/graph).
 *
 * These cover detail-level behavior (downsample 3:1, levelDb thresholds,
 * HANN symmetry, argMax, ...) on top of the conformance fixtures in
 * conformance.test.ts (which lock the numeric contract against scipy/numpy).
 *
 * @see ADR-032 (DSP platform package)
 */

import { describe, it, expect } from 'vitest'
import {
  createFft,
  levelDb,
  downsample48to16,
  downsampleForViz,
  computeSpectrum,
  sineWave,
  constant,
  argMax,
  FFT_SIZE,
  SPECTRUM_BINS,
  HANN_WINDOW,
} from '../src'

// fft()
// ---------------------------------------------------------------------------

describe('fft', () => {
  it('DC signal: energy concentrated in bin 0', () => {
    const n = 256
    const real = constant(1.0, n)
    const imag = new Float32Array(n)

    createFft(n).transform(real, imag)

    // Bin 0 (DC) should be n; all others ~0.
    expect(Math.abs(real[0] - n)).toBeLessThan(0.001)
    for (let i = 1; i < n; i++) {
      expect(Math.abs(real[i])).toBeLessThan(0.001)
      expect(Math.abs(imag[i])).toBeLessThan(0.001)
    }
  })

  it('Nyquist signal (alternating): energy in the last bin', () => {
    const n = 256
    const real = new Float32Array(n)
    const imag = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      real[i] = i % 2 === 0 ? 1 : -1
    }

    createFft(n).transform(real, imag)

    // Bin n/2 (Nyquist) should be n; all others ~0.
    expect(Math.abs(real[n / 2] - n)).toBeLessThan(0.001)
    expect(Math.abs(real[0])).toBeLessThan(0.001)
  })

  it('sine wave: peak at the corresponding frequency bin', () => {
    const n = 256
    const sampleRate = 48000
    const freqHz = 1875 // exactly bin 10 (1875 = 10 * 48000 / 256)
    const real = sineWave(freqHz, sampleRate, n)
    const imag = new Float32Array(n)

    createFft(n).transform(real, imag)

    // Find the peak bin.
    const mags = new Float32Array(n / 2)
    for (let i = 0; i < n / 2; i++) {
      mags[i] = Math.sqrt(real[i] * real[i] + imag[i] * imag[i])
    }
    const peak = argMax(mags)
    expect(peak).toBe(10)
  })

  it('conjugate symmetry for real input', () => {
    const n = 64
    const real = sineWave(1000, 48000, n)
    const imag = new Float32Array(n)

    createFft(n).transform(real, imag)

    // For real input: X[k] = conj(X[n-k]).
    for (let k = 1; k < n / 2; k++) {
      expect(Math.abs(real[k] - real[n - k])).toBeLessThan(0.001)
      expect(Math.abs(imag[k] + imag[n - k])).toBeLessThan(0.001)
    }
  })
})

// ---------------------------------------------------------------------------
// levelDb()
// ---------------------------------------------------------------------------

describe('levelDb', () => {
  it('silence returns the -120 dBFS floor', () => {
    expect(levelDb(new Float32Array(480))).toBe(-120)
  })

  it('DC at 1.0 returns 0 dBFS', () => {
    expect(levelDb(constant(1.0, 480))).toBeCloseTo(0, 1)
  })

  it('full-scale sine (~0.707 RMS) returns ~-3 dBFS', () => {
    const sine = sineWave(1000, 48000, 480, 1.0)
    expect(levelDb(sine)).toBeCloseTo(-3.01, 1)
  })

  it('half-amplitude sine returns ~-9 dBFS', () => {
    const sine = sineWave(1000, 48000, 480, 0.5)
    expect(levelDb(sine)).toBeCloseTo(-9.03, 1)
  })

  it('halving amplitude reduces level by ~6 dB', () => {
    const loud = sineWave(1000, 48000, 480, 1.0)
    const quiet = sineWave(1000, 48000, 480, 0.5)
    const diff = levelDb(loud) - levelDb(quiet)
    expect(diff).toBeCloseTo(6.02, 1)
  })
})

// ---------------------------------------------------------------------------
// downsample48to16()
// ---------------------------------------------------------------------------

describe('downsample48to16', () => {
  it('480 samples -> 160 samples (3:1 ratio)', () => {
    const input = constant(0.5, 480)
    const output = downsample48to16(input)
    expect(output.length).toBe(160)
  })

  it('DC signal preserved', () => {
    const input = constant(0.7, 480)
    const output = downsample48to16(input)
    for (const v of output) {
      expect(v).toBeCloseTo(0.7, 5)
    }
  })

  it('known ramp: averages groups of 3', () => {
    // [0,1,2, 3,4,5, 6,7,8] -> [(0+1+2)/3, (3+4+5)/3, (6+7+8)/3] = [1, 4, 7]
    const input = new Float32Array([0, 1, 2, 3, 4, 5, 6, 7, 8])
    const output = downsample48to16(input)
    expect(output.length).toBe(3)
    expect(output[0]).toBeCloseTo(1, 5)
    expect(output[1]).toBeCloseTo(4, 5)
    expect(output[2]).toBeCloseTo(7, 5)
  })

  it('sine wave frequency preserved (zero-crossing count)', () => {
    // 1 kHz sine at 48 kHz, 480 samples = 10 cycles.
    const input = sineWave(1000, 48000, 480)
    const output = downsample48to16(input)
    // After 3:1 downsample, 160 samples at 16 kHz. 1 kHz = 10 cycles.
    // Count zero crossings (should be ~20 for 10 cycles).
    let crossings = 0
    for (let i = 1; i < output.length; i++) {
      if ((output[i - 1] < 0 && output[i] >= 0) || (output[i - 1] >= 0 && output[i] < 0)) {
        crossings++
      }
    }
    // 10 cycles -> ~20 zero crossings. Allow tolerance for phase.
    expect(crossings).toBeGreaterThanOrEqual(18)
    expect(crossings).toBeLessThanOrEqual(22)
  })
})

// ---------------------------------------------------------------------------
// downsampleForViz()
// ---------------------------------------------------------------------------

describe('downsampleForViz', () => {
  it('output length matches requested points', () => {
    const input = constant(0.5, 480)
    expect(downsampleForViz(input, 128).length).toBe(128)
    expect(downsampleForViz(input, 64).length).toBe(64)
    expect(downsampleForViz(input, 256).length).toBe(256)
  })

  it('DC signal preserved', () => {
    const input = constant(0.42, 1000)
    const output = downsampleForViz(input, 128)
    for (const v of output) {
      expect(v).toBeCloseTo(0.42, 5)
    }
  })

  it('known input picks nearest samples', () => {
    // [10, 20, 30, 40], points=2, step=2 -> [input[0], input[2]] = [10, 30]
    const input = new Float32Array([10, 20, 30, 40])
    const output = downsampleForViz(input, 2)
    expect(output[0]).toBe(10)
    expect(output[1]).toBe(30)
  })

  it('handles input shorter than points (step < 1)', () => {
    const input = new Float32Array([1, 2, 3])
    const output = downsampleForViz(input, 10)
    expect(output.length).toBe(10)
    // floor(0 * 0.3) = 0, floor(1 * 0.3) = 0, floor(2 * 0.3) = 0, etc.
    // Values should all come from the input array.
    for (const v of output) {
      expect(v).toBeGreaterThanOrEqual(1)
      expect(v).toBeLessThanOrEqual(3)
    }
  })
})

// ---------------------------------------------------------------------------
// computeSpectrum()
// ---------------------------------------------------------------------------

describe('computeSpectrum', () => {
  it('returns SPECTRUM_BINS values', () => {
    const frame = constant(0, FFT_SIZE)
    const spectrum = computeSpectrum(frame)
    expect(spectrum.length).toBe(SPECTRUM_BINS)
  })

  it('silence produces all-zero spectrum', () => {
    const frame = constant(0, FFT_SIZE)
    const spectrum = computeSpectrum(frame)
    for (const v of spectrum) {
      expect(v).toBeLessThan(1e-10)
    }
  })

  it('DC signal: energy concentrated in bin 0', () => {
    const frame = constant(1.0, FFT_SIZE)
    const spectrum = computeSpectrum(frame)
    // With Hann window, DC is attenuated but still peaks at bin 0.
    expect(argMax(spectrum)).toBe(0)
    expect(spectrum[0]).toBeGreaterThan(0.1)
    // Hann window main lobe causes some leakage to adjacent bins, but bin 0
    // should remain the clear peak (all other bins strictly smaller).
    for (let i = 1; i < SPECTRUM_BINS; i++) {
      expect(spectrum[i]).toBeLessThan(spectrum[0])
    }
  })

  it('sine wave: peak at the corresponding frequency bin', () => {
    const sampleRate = 48000
    const binFreq = sampleRate / FFT_SIZE // Hz per bin = 187.5
    const targetBin = 10
    const freqHz = targetBin * binFreq // 1875 Hz
    const frame = sineWave(freqHz, sampleRate, FFT_SIZE)

    const spectrum = computeSpectrum(frame)
    const peak = argMax(spectrum)
    expect(peak).toBe(targetBin)
    // Peak should be significantly above the average.
    const avg = spectrum.reduce((a, b) => a + b, 0) / spectrum.length
    expect(spectrum[peak]).toBeGreaterThan(avg * 5)
  })

  it('higher frequency sine peaks at a higher bin', () => {
    const sampleRate = 48000
    const binFreq = sampleRate / FFT_SIZE
    const lowBin = 5
    const highBin = 20
    const lowFrame = sineWave(lowBin * binFreq, sampleRate, FFT_SIZE)
    const highFrame = sineWave(highBin * binFreq, sampleRate, FFT_SIZE)

    expect(argMax(computeSpectrum(lowFrame))).toBe(lowBin)
    expect(argMax(computeSpectrum(highFrame))).toBe(highBin)
  })
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

describe('sineWave', () => {
  it('generates correct length', () => {
    expect(sineWave(1000, 48000, 480).length).toBe(480)
  })

  it('generates values in [-amplitude, amplitude]', () => {
    const sine = sineWave(1000, 48000, 480, 0.8)
    for (const v of sine) {
      expect(v).toBeGreaterThanOrEqual(-0.81)
      expect(v).toBeLessThanOrEqual(0.81)
    }
  })

  it('first sample of a sine starting at phase 0 is 0', () => {
    expect(sineWave(1000, 48000, 480)[0]).toBeCloseTo(0, 5)
  })
})

describe('argMax', () => {
  it('finds the index of the maximum value', () => {
    expect(argMax(new Float32Array([1, 3, 2, 5, 4]))).toBe(3)
    expect(argMax(new Float32Array([5, 1, 2, 3]))).toBe(0)
    expect(argMax(new Float32Array([1, 2, 3, 9]))).toBe(3)
  })
})

describe('HANN_WINDOW', () => {
  it('has FFT_SIZE elements', () => {
    expect(HANN_WINDOW.length).toBe(FFT_SIZE)
  })

  it('is symmetric', () => {
    const n = HANN_WINDOW.length
    for (let i = 0; i < n / 2; i++) {
      expect(HANN_WINDOW[i]).toBeCloseTo(HANN_WINDOW[n - 1 - i], 5)
    }
  })

  it('starts and ends at 0', () => {
    expect(HANN_WINDOW[0]).toBeCloseTo(0, 5)
    expect(HANN_WINDOW[FFT_SIZE - 1]).toBeCloseTo(0, 5)
  })

  it('peaks at ~1.0 in the center', () => {
    // Hann formula: 0.5*(1 - cos(2*pi*i/(N-1))). At i=N/2, the cosine isn't
    // exactly -1 (because N/2 / (N-1) != 0.5), so the peak is ~0.99996.
    expect(HANN_WINDOW[FFT_SIZE / 2]).toBeCloseTo(1.0, 4)
  })
})
