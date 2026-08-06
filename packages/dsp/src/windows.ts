/**
 * Window functions - symmetric and periodic variants.
 *
 * Matches the definitions used by scipy.signal.get_window and torchaudio
 * (which underpin the conformance fixtures). Symmetric windows are used when
 * the window is applied to a whole FFT frame; periodic windows are used for
 * STFT hop framing (torch default).
 *
 * @see ADR-032 (DSP platform package)
 */

/** Periodic Hann window of `len` samples (torchaudio default). */
export function hannPeriodic(len: number): Float32Array {
  const out = new Float32Array(len)
  for (let i = 0; i < len; i++) out[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / len))
  return out
}

/** Symmetric Hann window of `len` samples (scipy `hann`, periodic=False). */
export function hannSymmetric(len: number): Float32Array {
  const out = new Float32Array(len)
  for (let i = 0; i < len; i++) out[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (len - 1)))
  return out
}

/** Hamming window (symmetric). */
export function hamming(len: number): Float32Array {
  const out = new Float32Array(len)
  for (let i = 0; i < len; i++) out[i] = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (len - 1))
  return out
}

/** Blackman window (symmetric). */
export function blackman(len: number): Float32Array {
  const out = new Float32Array(len)
  for (let i = 0; i < len; i++) {
    const x = (2 * Math.PI * i) / (len - 1)
    out[i] = 0.42 - 0.5 * Math.cos(x) + 0.08 * Math.cos(2 * x)
  }
  return out
}

/**
 * Seven-term Blackman-Harris window (symmetrical, Nuttall-style).
 *
 * Coefficients from the reference Spectro visualizer
 * (https://github.com/calebj0seph/spectro), which chose this window for its
 * minimal sidelobes (best visual clarity for spectrograms):
 *
 *    w[n] = a0 - a1*cos(2πn/N) + a2*cos(4πn/N) - a3*cos(6πn/N)
 *         + a4*cos(8πn/N) - a5*cos(10πn/N) + a6*cos(12πn/N)
 *
 * The spectrogram column generator (spectrogramColumn) uses this window with
 * an overlapping STFT to balance time/frequency resolution.
 */
export function blackmanHarris7(len: number): Float32Array {
  const COEFFICIENTS = [
    0.27105140069342,
    -0.43329793923448,
    0.21812299954311,
    -0.06592544638803,
    0.01081174209837,
    -0.00077658482522,
    0.00001388721735,
  ]
  const out = new Float32Array(len)
  for (let i = 0; i < len; i++) {
    let result = 0
    for (let k = 0; k < COEFFICIENTS.length; k++) {
      result += COEFFICIENTS[k] * Math.cos((2 * Math.PI * k * i) / len)
    }
    out[i] = result
  }
  return out
}

/** Apply a window in place (element-wise multiply). */
export function applyWindow(frame: Float32Array, window: Float32Array): void {
  const n = Math.min(frame.length, window.length)
  for (let i = 0; i < n; i++) frame[i] *= window[i]
}
