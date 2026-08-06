/**
 * PLiX shared front-end: Mel-spectrogram computation (browser-native).
 *
 * Both PLiX runtimes share the same acoustic front-end (the PLiX paper
 * §2.2.2): 16 kHz audio -> 64-bin mel spectrogram over a 1 s clip
 * (window 400 / hop 160, 60-7800 Hz). The ONNX graph consumes this
 * image directly as its input; @huggingface/transformers' `AutoModel`
 * computes an equivalent front-end internally, so for that runtime we
 * pass raw 16 kHz audio instead.
 *
 * Parameters are taken verbatim from `plixkws/backbone.py::Backbone`
 * (MelSpectrogram(sample_rate=16000, f_min=60, f_max=7800, n_mels=64,
 * win_length=400, hop_length=160, n_fft=1024); forward does
 * `log(melspec(x) + 1e-6)`). We match that exactly so an exported ONNX
 * graph and the Transformers.js pipeline produce identical embeddings.
 *
 * The numeric core lives in the platform DSP package (`@wake-studio/dsp`,
 * ADR-032): FFT (fft.js) + Slaney mel filterbank, locked by conformance
 * fixtures generated from scipy/numpy. This file only keeps the PLiX-specific
 * constants and the frame-axis helper (`fitFrames`). It still runs in any JS
 * environment, including an AudioWorklet (dsp is pure TS, no DOM/wasm).
 */

import { melSpectrogram as dspMelSpectrogram } from '@wake-studio/dsp'

// --- Mel front-end parameters (PLiX paper §2.2.2 / backbone.py) ---
export const PLIX_SAMPLE_RATE = 16000
export const PLIX_WINDOW_LENGTH = 400 // STFT window (25 ms)
export const PLIX_HOP_LENGTH = 160 // STFT hop (10 ms)
export const PLIX_N_MELS = 64 // mel bins
export const PLIX_MEL_FMIN = 60 // Hz
export const PLIX_MEL_FMAX = 7800 // Hz
export const PLIX_N_FFT = 1024
export const PLIX_LOG_OFFSET = 1e-6
/** Frames in a 1 s @ 16 kHz clip (SAMPLE_RATE / HOP_LENGTH). */
export const PLIX_TARGET_FRAMES = PLIX_SAMPLE_RATE / PLIX_HOP_LENGTH // 100

/**
 * Compute a 1 x 64 x T raw Mel-spectrogram (magnitude, NOT logged) from 16 kHz
 * mono audio. Returns a Float32Array of length 64*T laid out as [melBin,
 * frame], matching the ONNX / Transformers encoder's expected input image.
 *
 * IMPORTANT: the exported PLiX graph applies the log itself
 * (`EncoderTrunk.forward` does `x = log(mel + 1e-6)` before the CNN), so this
 * function returns the RAW mel magnitude. Feeding an already-logged spectrogram
 * would double-log (log of negative values -> NaN) and produce degenerate,
 * constant embeddings (the flat score-curve symptom). Keep this raw.
 *
 * Numerics: delegates to `@wake-studio/dsp`'s melSpectrogram with the PLiX
 * parameters (win 400 / hop 160 / n_fft 1024, 60-7800 Hz, 64 mel bins), which
 * is conformance-locked to the reference math.
 */
export function melSpectrogram(audio: Float32Array): Float32Array {
  return dspMelSpectrogram(audio, {
    sampleRate: PLIX_SAMPLE_RATE,
    nMel: PLIX_N_MELS,
    fMin: PLIX_MEL_FMIN,
    fMax: PLIX_MEL_FMAX,
    nFft: PLIX_N_FFT,
    hop: PLIX_HOP_LENGTH,
  })
}

/**
 * @deprecated Use {@link melSpectrogram} (raw mel magnitude). The exported
 * PLiX graph applies the log internally, so a pre-logged spectrogram is wrong
 * (double-log -> NaN). Retained only as a thin alias.
 */
export const logMelSpectrogram = melSpectrogram

/** Pad / trim a spectrogram's frame axis to exactly PLIX_TARGET_FRAMES. */
export function fitFrames(mel: Float32Array, numFrames: number): Float32Array {
  const out = new Float32Array(PLIX_N_MELS * PLIX_TARGET_FRAMES)
  if (numFrames >= PLIX_TARGET_FRAMES) {
    out.set(mel.subarray(0, PLIX_N_MELS * PLIX_TARGET_FRAMES))
  } else {
    out.set(mel) // zero-padded (silence) to the target length
  }
  return out
}

/** Front-end constants (for reuse / consistency checks). */
export const PLIX_FRONTEND = {
  sampleRate: PLIX_SAMPLE_RATE,
  windowLength: PLIX_WINDOW_LENGTH,
  hopLength: PLIX_HOP_LENGTH,
  nMels: PLIX_N_MELS,
  melFmin: PLIX_MEL_FMIN,
  melFmax: PLIX_MEL_FMAX,
  framesPerSecond: PLIX_TARGET_FRAMES,
}
