/**
 * OpenWakeWord KWS backend (ADR-020).
 *
 * Implements the openWakeWord-style pipeline:
 *   melspectrogram.onnx -> speech_embedding.onnx -> classifier.onnx
 *
 * Extracted from the Phase 2 worker so the engine is backend-agnostic. The
 * backend owns its own audio windowing (1280-sample mel window, 160-sample hop)
 * and the 16-step embedding ring buffer; the engine owns VAD gating, smoothing,
 * and trigger logic.
 *
 * @see docs/modules/kws.md §4-§5 (ADR-020)
 */

import * as ort from 'onnxruntime-web'
import type { BackendModelUrls, KWSBackend } from '../types'
import { MEL_HOP_SIZE, MEL_WINDOW_SIZE } from '../defaults'

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

/**
 * OpenWakeWord-style backend: mel-spectrogram -> speech-embedding -> classifier.
 *
 * Model I/O (hey-buddy / openWakeWord compatible):
 *   1. melspectrogram:  [1, samples]      -> [time, 1, mel_dim, 32]
 *   2. speech-embedding: [1, 76, 32, 1]   -> [1, 1, 1, 96]
 *   3. classifier:       [1, 16, 96]      -> [1, 1] (sigmoid score)
 *
 * The backend collects 16 consecutive embeddings (one per mel time step) before
 * running the classifier; until the ring buffer is full, processFrame returns
 * null (warmup).
 */
export class OpenWakeWordBackend implements KWSBackend {
  readonly id = 'openwakeword' as const
  readonly label = 'OpenWakeWord (mel -> embedding -> classifier)'

  private _melSession: ort.InferenceSession | null = null
  private _embedSession: ort.InferenceSession | null = null
  private _classifierSession: ort.InferenceSession | null = null

  // Audio window buffer (1280 samples = 80 ms @ 16 kHz).
  private _audioBuffer = new Float32Array(MEL_WINDOW_SIZE)
  private _bufferFill = 0

  // Embedding ring buffer: 16 x 96-dim.
  private static readonly EMBEDDING_COUNT = 16
  private static readonly EMBEDDING_DIM = 96
  private _embeddingBuffer = new Float32Array(
    OpenWakeWordBackend.EMBEDDING_COUNT * OpenWakeWordBackend.EMBEDDING_DIM,
  )
  private _embeddingIndex = 0
  private _embeddingFilled = false

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

    let score: number | null = null

    for (let i = 0; i < samples.length; i++) {
      this._audioBuffer[this._bufferFill++] = samples[i]
      if (this._bufferFill >= MEL_WINDOW_SIZE) {
        score = await this._runInference(this._audioBuffer)
        // Shift the buffer by one hop (10 ms overlap).
        this._audioBuffer.copyWithin(0, MEL_HOP_SIZE, MEL_WINDOW_SIZE)
        this._bufferFill = MEL_WINDOW_SIZE - MEL_HOP_SIZE
      }
    }

    return score
  }

  reset(): void {
    this._bufferFill = 0
    this._embeddingIndex = 0
    this._embeddingFilled = false
    this._embeddingBuffer.fill(0)
    this._audioBuffer.fill(0)
  }

  async dispose(): Promise<void> {
    this._melSession = null
    this._embedSession = null
    this._classifierSession = null
    this.reset()
  }

  /** Run the mel -> speech-embedding -> classifier pipeline on one window. */
  private async _runInference(audio: Float32Array): Promise<number | null> {
    if (!this._melSession || !this._embedSession || !this._classifierSession) {
      return null
    }

    // Step 1: melspectrogram - [1, samples] -> [time, 1, mel_dim, 32]
    const melInputName = this._melSession.inputNames[0]
    const audioTensor = new ort.Tensor('float32', audio, [1, audio.length])
    const melOutputs = await this._melSession.run({ [melInputName]: audioTensor })
    const melOutputName = this._melSession.outputNames[0]
    const melFeatures = melOutputs[melOutputName] as ort.Tensor
    const melData = melFeatures.data as Float32Array
    const melShape = melFeatures.dims as number[]
    const melTimeSteps = melShape[0]
    const melDim = melShape[2] // should be 76
    const melFeatureSize = melDim * 32 // 76 * 32 = 2432

    // Step 2: speech-embedding - for each mel time step, extract an embedding.
    // Input: [1, 76, 32, 1], Output: [1, 1, 1, 96]
    const embedInputName = this._embedSession.inputNames[0]
    const embedOutputName = this._embedSession.outputNames[0]

    for (let t = 0; t < melTimeSteps; t++) {
      const melSlice = melData.subarray(
        t * melFeatureSize,
        (t + 1) * melFeatureSize,
      )
      const embedInput = new Float32Array(melFeatureSize)
      embedInput.set(melSlice)
      const embedTensor = new ort.Tensor('float32', embedInput, [
        1,
        melDim,
        32,
        1,
      ])
      const embedOutputs = await this._embedSession.run({
        [embedInputName]: embedTensor,
      })
      const embedding = embedOutputs[embedOutputName] as ort.Tensor
      const embedData = embedding.data as Float32Array

      // Push the 96-dim embedding into the ring buffer.
      this._embeddingBuffer.set(
        embedData.subarray(0, OpenWakeWordBackend.EMBEDDING_DIM),
        this._embeddingIndex * OpenWakeWordBackend.EMBEDDING_DIM,
      )
      this._embeddingIndex =
        (this._embeddingIndex + 1) % OpenWakeWordBackend.EMBEDDING_COUNT
      if (this._embeddingIndex === 0) this._embeddingFilled = true
    }

    // Not enough embeddings yet - warmup.
    if (!this._embeddingFilled) return null

    // Step 3: classifier - [1, 16, 96] -> [1, 1]
    // Unroll the ring buffer into [1, 16, 96] (oldest first).
    const classifierInput = new Float32Array(
      OpenWakeWordBackend.EMBEDDING_COUNT * OpenWakeWordBackend.EMBEDDING_DIM,
    )
    for (let i = 0; i < OpenWakeWordBackend.EMBEDDING_COUNT; i++) {
      const srcIdx =
        ((this._embeddingIndex + i) % OpenWakeWordBackend.EMBEDDING_COUNT) *
        OpenWakeWordBackend.EMBEDDING_DIM
      classifierInput.set(
        this._embeddingBuffer.subarray(
          srcIdx,
          srcIdx + OpenWakeWordBackend.EMBEDDING_DIM,
        ),
        i * OpenWakeWordBackend.EMBEDDING_DIM,
      )
    }

    const classifierInputName = this._classifierSession.inputNames[0]
    const classifierTensor = new ort.Tensor('float32', classifierInput, [
      1,
      OpenWakeWordBackend.EMBEDDING_COUNT,
      OpenWakeWordBackend.EMBEDDING_DIM,
    ])
    const classifierOutputs = await this._classifierSession.run({
      [classifierInputName]: classifierTensor,
    })
    const classifierOutputName = this._classifierSession.outputNames[0]
    const scores = classifierOutputs[classifierOutputName] as ort.Tensor
    const scoreData = scores.data as Float32Array

    // The classifier outputs [1, 1] - a single score (sigmoid probability).
    const raw = scoreData[0]
    return raw < 0 ? 1 / (1 + Math.exp(-raw)) : Math.max(0, Math.min(1, raw))
  }
}
