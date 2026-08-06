/**
 * Mel filterbank + melSpectrogram - Slaney-style triangular filters.
 *
 * The math here is ported verbatim from `plixkws/backbone.py::Backbone`
 * (`MelSpectrogram(sample_rate=16000, f_min=60, f_max=7800, n_mels=64,
 * win_length=400, hop_length=160, n_fft=1024)`) - i.e. the exact front-end
 * the PLiX encoder was trained on. The conformance fixtures lock this against
 * the Python reference, so any refactor cannot silently drift.
 *
 * @see ADR-032 (DSP platform package)
 */

import { stft } from './stft'
import { hannPeriodic } from './windows'

export interface MelOptions {
  sampleRate: number
  nMel: number
  fMin: number
  fMax: number
  nFft: number
}

export interface MelFilterbank {
  /** Flat [melBin, fftBin] weights (Slaney triangular, rows sum to 1). */
  weights: Float32Array
  nMel: number
  nFft: number
  numFft: number
  /** Center frequencies in Hz (the filter peaks). */
  centerHz: Float32Array
}

function hzToMel(hz: number): number {
  return 2595 * Math.log10(1 + hz / 700)
}

function melToHz(mel: number): number {
  return 700 * (Math.pow(10, mel / 2595) - 1)
}

/**
 * Build a Slaney mel filterbank laid out as [melBin, fftBin] in a flat
 * Float32Array - identical to the original `plix-frontend.buildMelFilterbank`.
 */
export function buildMelFilterbank(opts: MelOptions): MelFilterbank {
  const { sampleRate, nMel, fMin, fMax, nFft } = opts
  const numFft = nFft / 2 + 1
  const hzPoints = new Float32Array(nMel + 2)
  const melMin = hzToMel(fMin)
  const melMax = hzToMel(fMax)
  for (let i = 0; i < nMel + 2; i++) {
    hzPoints[i] = melToHz(melMin + (i / (nMel + 1)) * (melMax - melMin))
  }
  const weights = new Float32Array(nMel * numFft)
  const centerHz = new Float32Array(nMel)
  for (let m = 1; m <= nMel; m++) {
    const fLeft = hzPoints[m - 1]
    const fCenter = hzPoints[m]
    const fRight = hzPoints[m + 1]
    centerHz[m - 1] = fCenter
    const kLeft = Math.floor((fLeft / (sampleRate / 2)) * (numFft - 1))
    const kCenter = Math.floor((fCenter / (sampleRate / 2)) * (numFft - 1))
    const kRight = Math.floor((fRight / (sampleRate / 2)) * (numFft - 1))
    for (let k = kLeft; k < kCenter; k++) {
      if (k >= 0 && k < numFft) {
        weights[(m - 1) * numFft + k] = (k - kLeft) / Math.max(1, kCenter - kLeft)
      }
    }
    for (let k = kCenter; k < kRight; k++) {
      if (k >= 0 && k < numFft) {
        weights[(m - 1) * numFft + k] = (kRight - k) / Math.max(1, kRight - kCenter)
      }
    }
  }
  return { weights, nMel, nFft, numFft, centerHz }
}

export interface MelSpectrogramOptions {
  nfft?: number
  hop?: number
  /** Window length in samples (defaults to 400, the PLiX convention). */
  winLen?: number
  window?: Float32Array
  magnitude?: boolean
  /** If true, apply log(mel + offset) at the end (used by some encoders). */
  log?: boolean
  logOffset?: number
}

/**
 * Compute a mel spectrogram from a mono signal.
 *
 * Returns a flat Float32Array laid out as [melBin, frame] (the same layout
 * `plix-frontend.melSpectrogram` produced, matching the ONNX graph's expected
 * 1x64xT input image). `magnitude: true` (default) emits raw mel magnitude;
 * set `log: true` to apply `log(mel + offset)`.
 */
export function melSpectrogram(
  signal: Float32Array,
  opts: MelOptions & MelSpectrogramOptions = {
    sampleRate: 16000,
    nMel: 64,
    fMin: 60,
    fMax: 7800,
    nFft: 1024,
  },
): Float32Array {
  const { sampleRate, nMel, fMin, fMax, nFft } = opts
  const hop = opts.hop ?? Math.floor(nFft / 4)
  const nfft = opts.nfft ?? nFft
  const winLen = opts.winLen ?? 400
  // Window is `winLen` samples long (PLiX uses 400); the frame is zero-padded
  // to `nfft` for the FFT.
  const window = opts.window ?? hannPeriodic(winLen)
  const numFft = nfft / 2 + 1

  const fb = buildMelFilterbank({ sampleRate, nMel, fMin, fMax, nFft: nfft })

  // STFT magnitude: reuse the shared stft() (magnitude mode). The window is
  // `winLen` samples long; the FFT zero-pads to `nfft` (PLiX convention).
  // NOTE: no 1/winSum normalization here - the PLiX reference math (and the
  // exported ONNX graph) uses raw |FFT| magnitudes, unlike scipy.signal.stft.
  const stftResult = stft(signal, {
    nfft,
    hop,
    frameLen: winLen,
    window,
    magnitude: true,
    rawMagnitude: true,
  })
  const frames = stftResult.frames

  const mel = new Float32Array(nMel * frames)
  for (let f = 0; f < frames; f++) {
    for (let m = 0; m < nMel; m++) {
      let sum = 0
      const wbase = m * numFft
      const sbase = f * numFft
      for (let k = 0; k < numFft; k++) {
        sum += fb.weights[wbase + k] * stftResult.data[sbase + k]
      }
      mel[m * frames + f] = sum
    }
  }

  if (opts.log) {
    const offset = opts.logOffset ?? 1e-6
    for (let i = 0; i < mel.length; i++) mel[i] = Math.log(mel[i] + offset)
  }
  return mel
}
