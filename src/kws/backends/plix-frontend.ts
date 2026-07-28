/**
 * PLiX shared front-end: log-Mel spectrogram computation (browser-native).
 *
 * Both PLiX runtimes share the same acoustic front-end (the PLiX paper
 * §2.2.2): 16 kHz audio -> 64-bin log-Mel spectrogram over a 1 s clip
 * (window 400 / hop 160, 60-7800 Hz). The ONNX graph consumes this
 * image directly as its input; @xenova/transformers' `feature-extraction`
 * pipeline computes an equivalent front-end internally, so for that runtime we
 * pass raw 16 kHz audio instead.
 *
 * Parameters are taken verbatim from `plixkws/backbone.py::Backbone`
 * (MelSpectrogram(sample_rate=16000, f_min=60, f_max=7800, n_mels=64,
 * win_length=400, hop_length=160, n_fft=1024); forward does
 * `log(melspec(x) + 1e-6)`). We match that exactly so an exported ONNX
 * graph and the Transformers.js pipeline produce identical embeddings.
 *
 * Kept dependency-free (no ONNX/TorchScript) so it can run in any JS
 * environment, including an AudioWorklet.
 */

// --- Log-Mel front-end parameters (PLiX paper §2.2.2 / backbone.py) ---
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
 * Build a 64 x (fft_bins+1) log-Mel filterbank (triangular, Slaney-style)
 * over [fmin, fmax]. Returns a flat Float32Array laid out as [melBin, fftBin].
 */
export function buildMelFilterbank(): Float32Array {
  const numFft = PLIX_N_FFT / 2 + 1
  const hzPoints = new Float32Array(PLIX_N_MELS + 2)
  const melMin = hzToMel(PLIX_MEL_FMIN)
  const melMax = hzToMel(PLIX_MEL_FMAX)
  for (let i = 0; i < PLIX_N_MELS + 2; i++) {
    hzPoints[i] = melToHz(melMin + (i / (PLIX_N_MELS + 1)) * (melMax - melMin))
  }
  const fb = new Float32Array(PLIX_N_MELS * numFft)
  for (let m = 1; m <= PLIX_N_MELS; m++) {
    const fLeft = hzPoints[m - 1]
    const fCenter = hzPoints[m]
    const fRight = hzPoints[m + 1]
    const kLeft = Math.floor((fLeft / (PLIX_SAMPLE_RATE / 2)) * (numFft - 1))
    const kCenter = Math.floor((fCenter / (PLIX_SAMPLE_RATE / 2)) * (numFft - 1))
    const kRight = Math.floor((fRight / (PLIX_SAMPLE_RATE / 2)) * (numFft - 1))
    for (let k = kLeft; k < kCenter; k++) {
      if (k >= 0 && k < numFft) {
        fb[(m - 1) * numFft + k] = (k - kLeft) / Math.max(1, kCenter - kLeft)
      }
    }
    for (let k = kCenter; k < kRight; k++) {
      if (k >= 0 && k < numFft) {
        fb[(m - 1) * numFft + k] = (kRight - k) / Math.max(1, kRight - kCenter)
      }
    }
  }
  return fb
}

function hzToMel(hz: number): number {
  return 2595 * Math.log10(1 + hz / 700)
}

function melToHz(mel: number): number {
  return 700 * (Math.pow(10, mel / 2595) - 1)
}

/** Hann window of `len` samples. */
export function hannWindow(len: number): Float32Array {
  const w = new Float32Array(len)
  for (let i = 0; i < len; i++) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (len - 1)))
  }
  return w
}

/**
 * Compute a 1 x 64 x T log-Mel spectrogram from 16 kHz mono audio.
 * Returns a Float32Array of length 64*T laid out as [melBin, frame], matching
 * the ONNX encoder's expected input image.
 */
export function logMelSpectrogram(audio: Float32Array): Float32Array {
  const numFft = PLIX_N_FFT / 2 + 1
  const window = hannWindow(PLIX_WINDOW_LENGTH)
  const fb = buildMelFilterbank()

  const numFrames =
    Math.floor((audio.length - PLIX_WINDOW_LENGTH) / PLIX_HOP_LENGTH) + 1
  const mel = new Float32Array(PLIX_N_MELS * numFrames)

  const frame = new Float32Array(PLIX_N_FFT)
  const spectrum = new Float32Array(numFft)

  for (let f = 0; f < numFrames; f++) {
    const start = f * PLIX_HOP_LENGTH
    frame.fill(0)
    for (let i = 0; i < PLIX_WINDOW_LENGTH; i++) {
      frame[i] = (audio[start + i] || 0) * window[i]
    }
    fftMag(frame, spectrum, PLIX_N_FFT)
    for (let m = 0; m < PLIX_N_MELS; m++) {
      let sum = 0
      for (let k = 0; k < numFft; k++) {
        sum += fb[m * numFft + k] * spectrum[k]
      }
      mel[m * numFrames + f] = Math.log(Math.max(sum, PLIX_LOG_OFFSET))
    }
  }
  return mel
}

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

/** In-place complex-free magnitude FFT (decimation-in-time radix-2). */
function fftMag(buffer: Float32Array, out: Float32Array, n: number): void {
  const real = new Float32Array(n)
  const imag = new Float32Array(n)
  for (let i = 0; i < n; i++) real[i] = buffer[i]
  fft(real, imag, n)
  for (let k = 0; k < n / 2 + 1; k++) {
    out[k] = Math.sqrt(real[k] * real[k] + imag[k] * imag[k])
  }
}

function fft(real: Float32Array, imag: Float32Array, n: number): void {
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      const tr = real[i]
      real[i] = real[j]
      real[j] = tr
      const ti = imag[i]
      imag[i] = imag[j]
      imag[j] = ti
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wr = Math.cos(ang)
    const wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let curR = 1
      let curI = 0
      for (let k = 0; k < len / 2; k++) {
        const aR = real[i + k]
        const aI = imag[i + k]
        const bR = real[i + k + len / 2] * curR - imag[i + k + len / 2] * curI
        const bI = real[i + k + len / 2] * curI + imag[i + k + len / 2] * curR
        real[i + k] = aR + bR
        imag[i + k] = aI + bI
        real[i + k + len / 2] = aR - bR
        imag[i + k + len / 2] = aI - bI
        const nextR = curR * wr - curI * wi
        curI = curR * wi + curI * wr
        curR = nextR
      }
    }
  }
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
