/**
 * WakeStudio platform DSP package (ADR-032).
 *
 * Pure-TS, no DOM/wasm, runs in any JS context (Node, browser, worker,
 * AudioWorklet). Numeric cores are either battle-tested third-party (fft.js)
 * or locked by conformance fixtures generated from scipy/torchaudio
 * (tests/conformance).
 */

export { createFft, fft, ifft } from './fft'

export { stft, istft } from './stft'
export type { StftOptions, StftResult } from './stft'

export {
  hannPeriodic,
  hannSymmetric,
  hamming,
  blackman,
  applyWindow,
} from './windows'

export { buildMelFilterbank, melSpectrogram } from './mel'
export type { MelOptions, MelFilterbank, MelSpectrogramOptions } from './mel'

export {
  computeSpectrum,
  sineWave,
  constant,
  argMax,
  FFT_SIZE,
  SPECTRUM_BINS,
  HANN_WINDOW,
} from './spectrum'

export {
  downsample48to16,
  downsampleForViz,
  levelDb,
  peakDbfs,
  rmsDbfs,
  isClipped,
  frameRms,
  applyGain,
  estimateSnrDb,
} from './level'
