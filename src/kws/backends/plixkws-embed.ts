/**
 * PLiX embedding provider (ADR-020 EmbedProvider, Phase 3).
 *
 * Loads the PLiX few-shot KWS encoder (ONNX) and extracts the 1280-dim speech
 * embedding for Few-Shot prototype matching. This is an auxiliary capability,
 * independent of the detection `KWSBackend`: it is loaded when a `plixkws` URL
 * is provided so `KWSEngine.embed()` works for enrollment regardless of which
 * detection backend is active.
 *
 * PLiX replaces WavLM-base-plus (which was too heavy for end-side devices) as
 * the Few-Shot encoder. The PLiX encoder is a compact CNN (EfficientNet-v2
 * "base" or TinyNet-E "small") trained as a Prototypical Network on 16 kHz
 * one-second clips; its penultimate global-average-pooled feature is a 1280-dim
 * embedding. See aaqibsaeed/plixkws (arXiv:2305.03058, Apache-2.0).
 *
 * Model I/O (per the PLiX paper / repo):
 *   input  : a log-Mel spectrogram image, shape [1, 1, 64, 100] (64 mel bins,
 *            100 frames over a 1 s @ 16 kHz clip; window 400 / hop 160, 60-7800 Hz)
 *   output : [1, 1280] embedding (global-average-pooled penultimate feature)
 *
 * The provider builds that spectrogram internally from 16 kHz mono audio, so
 * callers pass raw samples and the provider owns the front-end (mel filterbank,
 * 60-7800 Hz range, log-compression). No per-utterance Wav2Vec2-style
 * normalization is applied - PLiX trains on raw log-Mel spectrograms.
 *
 * Execution provider: the PLiX ONNX graph is pinned to **WASM (CPU)**, like the
 * prior WavLM embedder, because onnxruntime-web's WebGPU EP fails to compile the
 * graph's shape/op set at `run()` time. The OpenWakeWord detection backend still
 * uses WebGPU where supported; only this embedder is pinned to WASM.
 *
 * @see docs/modules/kws.md §4 (EmbedProvider), §5 (Few-Shot scaffold)
 * @see docs/modules/few-shot.md §4-§5
 */

import * as ort from 'onnxruntime-web'
import type { EmbedProvider } from '../types'

// --- Log-Mel front-end parameters (PLiX paper §2.2.2) ---
const SAMPLE_RATE = 16000
const WINDOW_LENGTH = 400 // STFT window (25 ms)
const HOP_LENGTH = 160 // STFT hop (10 ms)
const N_MELS = 64 // mel bins
const MEL_FMIN = 60 // Hz
const MEL_FMAX = 7800 // Hz
const FRAMES_PER_SECOND = 100 // SAMPLE_RATE / HOP_LENGTH
const TARGET_FRAMES = SAMPLE_RATE / HOP_LENGTH // 100 frames for a 1 s clip

/**
 * Build a 64 x T log-Mel filterbank matrix (num_bins x (fft_bins+1)).
 * Uses a simple triangular (Slaney-style) mel filterbank over [fmin, fmax].
 */
function buildMelFilterbank(): Float32Array {
  const fftSize = 2 ** Math.ceil(Math.log2(WINDOW_LENGTH))
  const numFft = fftSize / 2 + 1
  const hzPoints = new Float32Array(N_MELS + 2)
  const melMin = hzToMel(MEL_FMIN)
  const melMax = hzToMel(MEL_FMAX)
  for (let i = 0; i < N_MELS + 2; i++) {
    hzPoints[i] = melToHz(melMin + (i / (N_MELS + 1)) * (melMax - melMin))
  }
  const fb = new Float32Array(N_MELS * numFft)
  for (let m = 1; m <= N_MELS; m++) {
    const fLeft = hzPoints[m - 1]
    const fCenter = hzPoints[m]
    const fRight = hzPoints[m + 1]
    const kLeft = Math.floor((fLeft / (SAMPLE_RATE / 2)) * (numFft - 1))
    const kCenter = Math.floor((fCenter / (SAMPLE_RATE / 2)) * (numFft - 1))
    const kRight = Math.floor((fRight / (SAMPLE_RATE / 2)) * (numFft - 1))
    for (let k = kLeft; k < kCenter; k++) {
      if (k >= 0 && k < numFft) {
        fb[(m - 1) * numFft + k] =
          (k - kLeft) / Math.max(1, kCenter - kLeft)
      }
    }
    for (let k = kCenter; k < kRight; k++) {
      if (k >= 0 && k < numFft) {
        fb[(m - 1) * numFft + k] =
          (kRight - k) / Math.max(1, kRight - kCenter)
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
function hannWindow(len: number): Float32Array {
  const w = new Float32Array(len)
  for (let i = 0; i < len; i++) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (len - 1)))
  }
  return w
}

/**
 * Compute a 1 x 64 x T log-Mel spectrogram from 16 kHz mono audio.
 * Returns a Float32Array of length 64*T laid out as [melBin, frame].
 */
function logMelSpectrogram(audio: Float32Array): Float32Array {
  const fftSize = 2 ** Math.ceil(Math.log2(WINDOW_LENGTH))
  const numFft = fftSize / 2 + 1
  const window = hannWindow(WINDOW_LENGTH)
  const fb = buildMelFilterbank()

  const numFrames =
    Math.floor((audio.length - WINDOW_LENGTH) / HOP_LENGTH) + 1
  const mel = new Float32Array(N_MELS * numFrames)

  const frame = new Float32Array(fftSize)
  const spectrum = new Float32Array(numFft)

  for (let f = 0; f < numFrames; f++) {
    const start = f * HOP_LENGTH
    frame.fill(0)
    for (let i = 0; i < WINDOW_LENGTH; i++) {
      frame[i] = (audio[start + i] || 0) * window[i]
    }
    // Magnitude spectrum (naive DFT is too slow; use a compact radix-2 FFT).
    fftMag(frame, spectrum, fftSize)
    for (let m = 0; m < N_MELS; m++) {
      let sum = 0
      for (let k = 0; k < numFft; k++) {
        sum += fb[m * numFft + k] * spectrum[k]
      }
      // Log-compress; clamp to avoid log(0).
      mel[m * numFrames + f] = Math.log(Math.max(sum, 1e-5))
    }
  }
  return mel
}

/** In-place complex-free magnitude FFT (decimation-in-time radix-2). */
function fftMag(
  buffer: Float32Array,
  out: Float32Array,
  n: number,
): void {
  const real = new Float32Array(n)
  const imag = new Float32Array(n)
  for (let i = 0; i < n; i++) real[i] = buffer[i]
  fft(real, imag, n)
  for (let k = 0; k < n / 2 + 1; k++) {
    out[k] = Math.sqrt(real[k] * real[k] + imag[k] * imag[k])
  }
}

function fft(real: Float32Array, imag: Float32Array, n: number): void {
  // Bit-reversal permutation.
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

/** Pad / trim a spectrogram's frame axis to exactly TARGET_FRAMES. */
function fitFrames(mel: Float32Array, numFrames: number): Float32Array {
  const out = new Float32Array(N_MELS * TARGET_FRAMES)
  if (numFrames >= TARGET_FRAMES) {
    out.set(mel.subarray(0, N_MELS * TARGET_FRAMES))
  } else {
    // Zero-pad (silence) to the target length.
    out.set(mel)
  }
  return out
}

/**
 * PLiX encoder embedder. Expects 16 kHz mono float32 input; the caller is
 * responsible for resampling (the AFE output is already 16 kHz). The provider
 * computes the log-Mel front-end internally and runs the encoder ONNX.
 */
export class PlixKwsEmbedProvider implements EmbedProvider {
  private _session: ort.InferenceSession | null = null
  private _inputName = ''

  get ready(): boolean {
    return this._session !== null
  }

  async load(url: string, _provider: 'webgpu' | 'wasm'): Promise<void> {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(
        `Failed to fetch ${url}: ${response.status} ${response.statusText}`,
      )
    }
    const buffer = await response.arrayBuffer()
    // Force WASM only. The `provider` arg is intentionally ignored (see the
    // class docstring): this model's graph is incompatible with ORT-Web's
    // WebGPU EP and would otherwise fail at `run()` time.
    this._session = await ort.InferenceSession.create(buffer, {
      executionProviders: ['wasm'],
    })
    this._inputName = this._session.inputNames[0]
  }

  async embed(audio: Float32Array, sampleRate: number): Promise<Float32Array> {
    if (sampleRate !== SAMPLE_RATE) {
      throw new Error(
        `PLiX encoder expects ${SAMPLE_RATE} Hz audio; got ${sampleRate} Hz.`,
      )
    }
    if (!this._session) {
      throw new Error('PLiX encoder not loaded; embed() unavailable.')
    }

    // Front-end: 1 x 64 x 100 log-Mel spectrogram (the model's expected input).
    let mel = logMelSpectrogram(audio)
    const numFrames = Math.floor(
      (audio.length - WINDOW_LENGTH) / HOP_LENGTH + 1,
    )
    mel = fitFrames(mel, numFrames)

    const inputTensor = new ort.Tensor('float32', mel, [1, 1, N_MELS, TARGET_FRAMES])
    const outputs = await this._session.run({ [this._inputName]: inputTensor })

    const outputName = this._session.outputNames.includes('embeddings')
      ? 'embeddings'
      : this._session.outputNames[0]
    const embedding = outputs[outputName] as ort.Tensor
    return embedding.data as Float32Array
  }

  async dispose(): Promise<void> {
    this._session = null
  }
}

// Re-export the frame constants so the backend can reuse them for consistency.
export const PLIX_FRONTEND = {
  sampleRate: SAMPLE_RATE,
  windowLength: WINDOW_LENGTH,
  hopLength: HOP_LENGTH,
  nMels: N_MELS,
  melFmin: MEL_FMIN,
  melFmax: MEL_FMAX,
  framesPerSecond: FRAMES_PER_SECOND,
}
