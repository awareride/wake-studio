/**
 * OpenWakeWord KWS backend (ADR-020).
 *
 * Implements the openWakeWord-style pipeline:
 *   melspectrogram.onnx -> speech_embedding.onnx -> classifier.onnx
 *
 * Extracted from the Phase 2 worker so the engine is backend-agnostic. The
 * backend owns its own audio windowing, mel-frame buffer, and the 16-step
 * embedding ring buffer; the engine owns VAD gating, smoothing, and trigger
 * logic.
 *
 * Model I/O (verified against the ONNX graphs + openWakeWord utils.py):
 *   1. melspectrogram.onnx:  input [1, samples] -> output [1, 1, time, 32]
 *      (32 mel bins; time = floor((samples - 400) / 160) + 1, no center pad)
 *      A post-model transform x/10 + 2 is REQUIRED (openWakeWord melspec_transform).
 *   2. embedding_model.onnx: input [1, 76, 32, 1] (76 mel FRAMES) -> [1, 1, 1, 96]
 *   3. classifier:           input [1, 16, 96]    -> [1, 1] (already sigmoid'd)
 *
 * Streaming: each 1280-sample chunk (80 ms) + 480-sample overlap (openWakeWord's
 * 160*3) feeds the mel model, producing ~8 frames. Frames accumulate in a mel
 * buffer; the last 76 frames produce one 96-dim embedding per chunk. 16
 * embeddings fill the classifier's receptive field (~1.3 s); after that, one
 * score per 80 ms.
 *
 * @see docs/modules/kws.md §4-§5 (ADR-020)
 * @see openWakeWord openwakeword/utils.py AudioFeatures (_streaming_features)
 */

import * as ort from 'onnxruntime-web'
import type { BackendModelUrls, KWSBackend } from '../types'
import { MEL_OVERLAP, MEL_WINDOW_SIZE } from '../defaults'

// Use the CDN for the onnxruntime-web WASM runtime files (Phase 6 will vendor
// these for offline support, consistent with the RNNoise vendoring in Phase 1).
// Set once at module load; shared with any other backend in this worker.
ort.env.wasm.wasmPaths =
  'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/'

/** Fetch a model URL and create an InferenceSession. */
async function loadModel(
  url: string,
  ep: 'webgpu' | 'wasm',
): Promise<ort.InferenceSession> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(
      `Failed to fetch ${url}: ${response.status} ${response.statusText}`,
    )
  }
  const buffer = await response.arrayBuffer()
  return ort.InferenceSession.create(buffer, {
    executionProviders: ep === 'webgpu' ? ['webgpu', 'wasm'] : ['wasm'],
  })
}

/** openWakeWord melspectrogram post-transform (utils.py melspec_transform). */
function melTransform(x: number): number {
  return x / 10 + 2
}

/** Mel-frame window the embedding model consumes (openWakeWord window_size). */
const EMBEDDING_WINDOW = 76
/** Embedding dimensionality (speech_embedding output). */
const EMBEDDING_DIM = 96
/** Classifier receptive field: 16 consecutive embeddings. */
const CLASSIFIER_STEPS = 16
/** Max mel frames kept in the sliding buffer (~1 s at 100 Hz). */
const MEL_MAX_FRAMES = 100
/** Rolling audio buffer capacity (>= MEL_WINDOW_SIZE + MEL_OVERLAP). */
const AUDIO_RING_CAP = 2048

/**
 * OpenWakeWord-style backend: mel-spectrogram -> speech-embedding -> classifier.
 */
export class OpenWakeWordBackend implements KWSBackend {
  readonly id = 'openwakeword' as const
  readonly label = 'OpenWakeWord (mel -> embedding -> classifier)'

  private _melSession: ort.InferenceSession | null = null
  private _embedSession: ort.InferenceSession | null = null
  private _classifierSession: ort.InferenceSession | null = null

  // Rolling audio buffer (keeps overlap context between mel computations).
  private _audioRing = new Float32Array(AUDIO_RING_CAP)
  private _audioLen = 0
  private _newSamples = 0

  // Sliding mel-frame buffer: each entry is 32 mel values.
  private _melFrames: Float32Array[] = []

  // Embedding ring buffer: CLASSIFIER_STEPS x EMBEDDING_DIM.
  private _embeddingBuffer = new Float32Array(
    CLASSIFIER_STEPS * EMBEDDING_DIM,
  )
  private _embeddingIndex = 0
  private _embeddingFilled = false

  // Serialization guard (ONNX sessions are not re-entrant). When in flight,
  // processFrame drops the incoming frame - the mel window tolerates a few
  // dropped 10 ms frames (87.5% overlap).
  private _inferring = false

  get ready(): boolean {
    return (
      this._melSession !== null &&
      this._embedSession !== null &&
      this._classifierSession !== null
    )
  }

  async load(urls: BackendModelUrls, provider: 'webgpu' | 'wasm'): Promise<void> {
    if (!urls.melspectrogram || !urls.embedding || !urls.classifier) {
      throw new Error(
        'OpenWakeWord backend requires melspectrogram, embedding, and classifier model URLs.',
      )
    }
    this._melSession = await loadModel(urls.melspectrogram, provider)
    this._embedSession = await loadModel(urls.embedding, provider)
    this._classifierSession = await loadModel(urls.classifier, provider)
  }

  async processFrame(samples: Float32Array): Promise<number | null> {
    if (!this.ready) return null
    // Serialization: drop frames while inference is in flight. The mel window
    // has 87.5% overlap so a few dropped frames don't break detection.
    if (this._inferring) return null
    this._inferring = true
    try {
      // Append incoming samples to the rolling audio buffer.
      this._pushAudio(samples)
      this._newSamples += samples.length

      let score: number | null = null

      // Process one 1280-sample chunk at a time (multiple if a large frame arrives).
      while (this._newSamples >= MEL_WINDOW_SIZE) {
        this._newSamples -= MEL_WINDOW_SIZE
        const s = await this._processChunk()
        if (s !== null) score = s
      }

      return score
    } finally {
      this._inferring = false
    }
  }

  reset(): void {
    this._audioLen = 0
    this._newSamples = 0
    this._melFrames.length = 0
    this._embeddingIndex = 0
    this._embeddingFilled = false
    this._embeddingBuffer.fill(0)
    this._audioRing.fill(0)
  }

  async dispose(): Promise<void> {
    this._melSession = null
    this._embedSession = null
    this._classifierSession = null
    this.reset()
  }

  // ---- internals ----

  /** Append samples to the rolling audio buffer, evicting old data if needed. */
  private _pushAudio(samples: Float32Array): void {
    if (this._audioLen + samples.length > AUDIO_RING_CAP) {
      // Evict oldest to make room (keep as much overlap context as possible).
      const keep = AUDIO_RING_CAP - samples.length
      if (keep > 0) {
        this._audioRing.copyWithin(0, this._audioLen - keep, this._audioLen)
      }
      this._audioLen = keep
    }
    this._audioRing.set(samples, this._audioLen)
    this._audioLen += samples.length
  }

  /** Process one 1280-sample chunk (+ overlap) through mel -> embed -> classify. */
  private async _processChunk(): Promise<number | null> {
    if (!this._melSession || !this._embedSession || !this._classifierSession) {
      return null
    }

    // Take the last (MEL_WINDOW_SIZE + MEL_OVERLAP) samples for mel, with the
    // 480-sample overlap matching openWakeWord's streaming frame rate (~8 frames).
    const inputLen = Math.min(this._audioLen, MEL_WINDOW_SIZE + MEL_OVERLAP)
    const melAudio = this._audioRing.subarray(
      this._audioLen - inputLen,
      this._audioLen,
    )

    // Step 1: melspectrogram -> [1, 1, time, 32]
    const melInputName = this._melSession.inputNames[0]
    const melTensor = new ort.Tensor('float32', melAudio, [1, inputLen])
    const melOutputs = await this._melSession.run({ [melInputName]: melTensor })
    const melResult = melOutputs[this._melSession.outputNames[0]] as ort.Tensor
    const melData = melResult.data as Float32Array
    const melDims = melResult.dims as number[]
    // melDims = [1, 1, time, 32]; time frames, 32 mel bins each.
    const melTime = melDims[2]
    const melBins = melDims[3] // 32

    // Squeeze + transform: extract [time, 32] frames, apply x/10 + 2.
    for (let t = 0; t < melTime; t++) {
      const frame = new Float32Array(melBins)
      const base = t * melBins
      for (let b = 0; b < melBins; b++) {
        frame[b] = melTransform(melData[base + b])
      }
      this._melFrames.push(frame)
    }
    // Trim the mel-frame buffer (sliding window).
    if (this._melFrames.length > MEL_MAX_FRAMES) {
      this._melFrames.splice(0, this._melFrames.length - MEL_MAX_FRAMES)
    }

    // Not enough mel frames for one embedding window yet (warmup).
    if (this._melFrames.length < EMBEDDING_WINDOW) return null

    // Step 2: speech-embedding - take last 76 frames -> [1, 76, 32, 1] -> [1,1,1,96]
    const embedInput = new Float32Array(EMBEDDING_WINDOW * melBins)
    const startFrame = this._melFrames.length - EMBEDDING_WINDOW
    for (let i = 0; i < EMBEDDING_WINDOW; i++) {
      embedInput.set(this._melFrames[startFrame + i], i * melBins)
    }
    const embedInputName = this._embedSession.inputNames[0]
    const embedTensor = new ort.Tensor('float32', embedInput, [
      1,
      EMBEDDING_WINDOW,
      melBins,
      1,
    ])
    const embedOutputs = await this._embedSession.run({
      [embedInputName]: embedTensor,
    })
    const embedResult = embedOutputs[
      this._embedSession.outputNames[0]
    ] as ort.Tensor
    const embedData = embedResult.data as Float32Array

    // Push the 96-dim embedding into the ring buffer.
    this._embeddingBuffer.set(
      embedData.subarray(0, EMBEDDING_DIM),
      this._embeddingIndex * EMBEDDING_DIM,
    )
    this._embeddingIndex = (this._embeddingIndex + 1) % CLASSIFIER_STEPS
    if (this._embeddingIndex === 0) this._embeddingFilled = true

    // Not enough embeddings for the classifier yet (warmup).
    if (!this._embeddingFilled) return null

    // Step 3: classifier - unroll ring -> [1, 16, 96] -> [1, 1] (already sigmoid'd)
    const classifierInput = new Float32Array(
      CLASSIFIER_STEPS * EMBEDDING_DIM,
    )
    for (let i = 0; i < CLASSIFIER_STEPS; i++) {
      const srcIdx =
        ((this._embeddingIndex + i) % CLASSIFIER_STEPS) * EMBEDDING_DIM
      classifierInput.set(
        this._embeddingBuffer.subarray(srcIdx, srcIdx + EMBEDDING_DIM),
        i * EMBEDDING_DIM,
      )
    }
    const classifierInputName = this._classifierSession.inputNames[0]
    const classifierTensor = new ort.Tensor('float32', classifierInput, [
      1,
      CLASSIFIER_STEPS,
      EMBEDDING_DIM,
    ])
    const classifierOutputs = await this._classifierSession.run({
      [classifierInputName]: classifierTensor,
    })
    const classifierResult = classifierOutputs[
      this._classifierSession.outputNames[0]
    ] as ort.Tensor
    const raw = (classifierResult.data as Float32Array)[0]
    // The classifier has a Sigmoid output node (verified in the ONNX graph), so
    // `raw` is already a probability [0,1]. Clamp for floating-point safety.
    return Math.max(0, Math.min(1, raw))
  }
}
