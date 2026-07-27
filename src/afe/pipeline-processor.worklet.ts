/**
 * AFE pipeline AudioWorklet processor (single-worklet topology, ADR-016).
 *
 * Runs the stage chain AEC -> BSS -> NS at 48 kHz inside a single AudioWorklet:
 *   - AEC: passthrough (WebRTC AEC3 deferred to v1.x, ADR-016)
 *   - BSS: passthrough (single-mic, ADR-016)
 *   - NS:  RNNoise (vendored prebuilt WASM, denoises 480-sample frames)
 *
 * Emits per-stage visualization data (throttled to vizFps) and 16 kHz output
 * frames (160 samples / 10 ms) for downstream KWS.
 *
 * The circular-buffer approach follows the vendored NoiseSuppressorWorklet:
 * buffer size = LCM(128, 480) = 1920, so residues never split on wrap-around.
 */

// Vendored prebuilt RNNoise (WASM embedded in rnnoise-sync.js as base64).
import './vendor/rnnoise/polyfills'
import RnnoiseProcessor from './vendor/rnnoise/RnnoiseProcessor'
import createRNNWasmModuleSync from './vendor/rnnoise/generated/rnnoise-sync'
import type { MainMessage, StageFrameData, WorkletMessage } from './types'
import { CIRCULAR_BUFFER_SIZE, DOWNSAMPLE_RATIO, RNNOISE_FRAME_SIZE } from './defaults'

const PROCESSOR_NAME = 'pipeline-processor'

/** FFT size for spectrum computation (must be power of 2, <= RNNOISE_FRAME_SIZE). */
const FFT_SIZE = 256
/** Number of magnitude bins emitted for the spectrogram (FFT_SIZE / 4). */
const SPECTRUM_BINS = 64

/** Pre-computed Hann window for FFT. */
const HANN_WINDOW = new Float32Array(FFT_SIZE)
for (let i = 0; i < FFT_SIZE; i++) {
  HANN_WINDOW[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)))
}

/** In-place radix-2 Cooley-Tukey FFT (n must be a power of 2). */
function fft(real: Float32Array, imag: Float32Array, n: number): void {
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

class PipelineProcessor extends AudioWorkletProcessor {
  private _rnnoise: RnnoiseProcessor | null = null
  private _nsOk = false

  // Circular buffer (LCM(128, 480) = 1920 samples).
  private _buffer = new Float32Array(CIRCULAR_BUFFER_SIZE)
  private _inputLength = 0
  private _denoisedLength = 0
  private _denoisedIndex = 0

  // Downsampled output (160 samples at 16 kHz per RNNoise frame).
  private _output160 = new Float32Array(RNNOISE_FRAME_SIZE / DOWNSAMPLE_RATIO)

  // Viz throttling.
  private _lastVizTime = 0
  private _vizInterval = 1 / 30 // seconds; updated from config

  // Config (updated via messages).
  private _bypass = { aec: true, bss: true, ns: false }
  private _abSource: 'raw' | 'processed' = 'processed'

  // Recording state.
  private _recording = false
  private _recordRemaining = 0
  private _rawRecord: Float32Array | null = null
  private _processedRecord: Float32Array | null = null
  private _recordOffset = 0

  // Pre-allocated FFT buffers (avoid GC in process()).
  private _fftReal = new Float32Array(FFT_SIZE)
  private _fftImag = new Float32Array(FFT_SIZE)

  // Last denoised NS frame (always available for viz, even during buffer wrap-around).
  private _lastNsFrame = new Float32Array(RNNOISE_FRAME_SIZE)
  private _hasNsFrame = false

  constructor() {
    super()

    // Synchronously instantiate RNNoise (addModule doesn't await promises).
    try {
      this._rnnoise = new RnnoiseProcessor(createRNNWasmModuleSync())
      this._nsOk = true
    } catch (err) {
      this._rnnoise = null
      this._nsOk = false
      this._post({ type: 'error', message: `RNNoise init failed: ${String(err)}` })
    }

    this.port.onmessage = (e: MessageEvent<MainMessage>) => {
      this._handleMessage(e.data)
    }

    this._post({ type: 'ready' })
  }

  private _handleMessage(msg: MainMessage): void {
    switch (msg.type) {
      case 'config':
        this._bypass = msg.bypass
        this._vizInterval = 1 / msg.vizFps
        break
      case 'absource':
        this._abSource = msg.source
        break
      case 'record': {
        const total = Math.floor(msg.seconds * sampleRate)
        this._rawRecord = new Float32Array(total)
        this._processedRecord = new Float32Array(total)
        this._recordRemaining = total
        this._recordOffset = 0
        this._recording = true
        break
      }
      case 'stop':
        // The node is destroyed from the main thread; nothing to do here.
        break
    }
  }

  private _post(msg: WorkletMessage): void {
    this.port.postMessage(msg)
  }

  /** Compute RMS level in dBFS for a frame. */
  private _levelDb(frame: Float32Array): number {
    let sum = 0
    for (let i = 0; i < frame.length; i++) {
      sum += frame[i] * frame[i]
    }
    const rms = Math.sqrt(sum / frame.length)
    return rms < 1e-10 ? -120 : 20 * Math.log10(rms)
  }

  /** Downsample 48 kHz -> 16 kHz by averaging groups of 3 samples. */
  private _downsample(frame480: Float32Array): Float32Array {
    const out = this._output160
    for (let i = 0, j = 0; i < frame480.length; i += DOWNSAMPLE_RATIO, j++) {
      let sum = 0
      for (let k = 0; k < DOWNSAMPLE_RATIO; k++) {
        sum += frame480[i + k]
      }
      out[j] = sum / DOWNSAMPLE_RATIO
    }
    return out
  }

  /** Downsample a frame to N points for waveform display. */
  private _downsampleForViz(frame: Float32Array, points: number): Float32Array {
    const out = new Float32Array(points)
    const step = frame.length / points
    for (let i = 0; i < points; i++) {
      out[i] = frame[Math.floor(i * step)]
    }
    return out
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const inData = inputs[0]?.[0]
    const outData = outputs[0]?.[0]
    if (!inData) return true

    // --- 1. Append raw input to the circular buffer ---
    this._buffer.set(inData, this._inputLength)
    this._inputLength += inData.length

    // --- 2. Process RNNoise frames (480 samples each) ---
    while (this._denoisedLength + RNNOISE_FRAME_SIZE <= this._inputLength) {
      const frame = this._buffer.subarray(
        this._denoisedLength,
        this._denoisedLength + RNNOISE_FRAME_SIZE,
      )

      // AEC -> BSS -> NS (all passthrough except NS for v1).
      // AEC: passthrough (copy through, no-op since we operate in place).
      // BSS: passthrough.
      // NS: RNNoise denoise (or passthrough if bypassed/failed).
      let vad = 0
      if (!this._bypass.ns && this._nsOk && this._rnnoise) {
        vad = this._rnnoise.processAudioFrame(frame, true)
      }

      // Keep a copy of the last NS frame for stable visualization
      // (avoids intermittent missing data during circular-buffer wrap-around).
      this._lastNsFrame.set(frame)
      this._hasNsFrame = true

      // Downsample to 16 kHz and post output for KWS.
      const out160 = this._downsample(frame)
      this._post({
        type: 'output',
        samples: new Float32Array(out160),
        capturedAtMs: currentTime,
        vad,
      })

      this._denoisedLength += RNNOISE_FRAME_SIZE
    }

    // --- 3. Copy denoised audio to the output quantum (for monitoring) ---
    let unsent: number
    if (this._denoisedIndex > this._denoisedLength) {
      unsent = CIRCULAR_BUFFER_SIZE - this._denoisedIndex
    } else {
      unsent = this._denoisedLength - this._denoisedIndex
    }

    if (unsent >= outData.length) {
      const chunk = this._buffer.subarray(
        this._denoisedIndex,
        this._denoisedIndex + outData.length,
      )
      // During recording, always output processed so the user hears denoised audio.
      const source = this._recording ? 'processed' : this._abSource
      if (source === 'processed') {
        outData.set(chunk)
      } else {
        // Raw: the input we just received (for A/B comparison).
        outData.set(inData)
      }
      this._denoisedIndex += outData.length
    }

    // --- 3b. Recording: capture raw + processed ---
    if (this._recording && this._rawRecord && this._processedRecord) {
      const n = Math.min(inData.length, this._recordRemaining)
      this._rawRecord.set(inData.subarray(0, n), this._recordOffset)
      this._processedRecord.set(outData.subarray(0, n), this._recordOffset)
      this._recordOffset += n
      this._recordRemaining -= n
      if (this._recordRemaining <= 0) {
        this._recording = false
        this._post({
          type: 'recorded',
          raw: this._rawRecord,
          processed: this._processedRecord,
          sampleRate,
        })
        this._rawRecord = null
        this._processedRecord = null
      }
    }

    // --- 4. Handle circular buffer wrap-around ---
    if (this._denoisedIndex >= CIRCULAR_BUFFER_SIZE) {
      this._denoisedIndex = 0
    }
    if (this._inputLength >= CIRCULAR_BUFFER_SIZE) {
      this._inputLength = 0
      this._denoisedLength = 0
    }

    // --- 5. Post visualization data (throttled to vizFps) ---
    if (currentTime - this._lastVizTime >= this._vizInterval) {
      this._lastVizTime = currentTime
      this._postVizData(inData)
    }

    return true
  }

  private _postVizData(rawInput: Float32Array): void {
    const capturedAtMs = currentTime
    const vizPoints = 128
    const frames: StageFrameData[] = []

    // AEC stage (passthrough for v1): shows raw input.
    frames.push({
      stageId: 'aec',
      kind: 'aec',
      capturedAtMs,
      waveform: this._downsampleForViz(rawInput, vizPoints),
      levelDb: this._levelDb(rawInput),
    })

    // BSS stage (passthrough): same as AEC output.
    frames.push({
      stageId: 'bss',
      kind: 'bss',
      capturedAtMs,
      levelDb: this._levelDb(rawInput),
    })

    // NS stage: always use the last denoised frame (stable, no intermittent gaps).
    const nsFrame = this._hasNsFrame
      ? this._lastNsFrame
      : rawInput.subarray(0, Math.min(RNNOISE_FRAME_SIZE, rawInput.length))
    frames.push({
      stageId: 'ns',
      kind: 'ns',
      capturedAtMs,
      waveform: this._downsampleForViz(nsFrame, vizPoints),
      levelDb: this._levelDb(nsFrame),
      spectrum: this._computeSpectrum(nsFrame),
    })

    this._post({ type: 'frame', frames })
  }

  /** Compute a magnitude spectrum (SPECTRUM_BINS bins) from a frame. */
  private _computeSpectrum(frame: Float32Array): Float32Array {
    const real = this._fftReal
    const imag = this._fftImag
    // Copy first FFT_SIZE samples with Hann window.
    for (let i = 0; i < FFT_SIZE; i++) {
      real[i] = frame[i] * HANN_WINDOW[i]
      imag[i] = 0
    }
    fft(real, imag, FFT_SIZE)
    // Magnitude of the first SPECTRUM_BINS bins (low-to-mid frequencies).
    const mag = new Float32Array(SPECTRUM_BINS)
    for (let i = 0; i < SPECTRUM_BINS; i++) {
      mag[i] = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]) / FFT_SIZE
    }
    return mag
  }
}

registerProcessor(PROCESSOR_NAME, PipelineProcessor)
