/**
 * KWS Web Worker - ONNX inference loop (ADR-018).
 *
 * Runs off-main-thread to avoid blocking the UI. Loads the openWakeWord-style
 * model pipeline (melspectrogram -> embedding -> classifier) and runs inference
 * on each 10 ms audio frame from the AFE. Also handles Few-Shot `embed()`
 * requests (WavLM encoder) for Phase 3.
 *
 * Pure logic (ScoreSmoother, TriggerDetector, VAD gate) is in ./dsp.
 */

import * as ort from 'onnxruntime-web'
import type {
  KWSConfig,
  KWSMainMessage,
  KWSWorkerMessage,
  ModelUrls,
} from './types'
import { DEFAULT_CONFIG, MEL_HOP_SIZE, MEL_WINDOW_SIZE } from './defaults'
import { ScoreSmoother, TriggerDetector, shouldGateByVad } from './dsp'

// Use the CDN for the onnxruntime-web WASM runtime files (Phase 6 will vendor
// these for offline support, consistent with the RNNoise vendoring in Phase 1).
ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/'

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let config: KWSConfig = { ...DEFAULT_CONFIG }

let melSession: ort.InferenceSession | null = null
let embedSession: ort.InferenceSession | null = null
let classifierSession: ort.InferenceSession | null = null
let wavlmSession: ort.InferenceSession | null = null

let actualExecutionProvider: 'webgpu' | 'wasm' = 'wasm'

// Inference state.
const audioBuffer = new Float32Array(MEL_WINDOW_SIZE)
let bufferFill = 0
let smoother = new ScoreSmoother(config.smoothingWindowFrames)
const trigger = new TriggerDetector(
  config.threshold,
  config.minDurationMs,
  config.cooldownMs,
  'hey-buddy',
)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function post(msg: KWSMainMessage): void {
  postMessage(msg)
}

function postError(message: string): void {
  post({ type: 'error', message })
}

/** Detect the best available execution provider (WebGPU-first, ADR-018). */
async function detectExecutionProvider(): Promise<'webgpu' | 'wasm'> {
  // navigator.gpu is available in workers in modern browsers.
  if (typeof navigator !== 'undefined' && 'gpu' in navigator) {
    try {
      const adapter = await (navigator as unknown as { gpu: { requestAdapter: () => Promise<unknown> } }).gpu.requestAdapter()
      if (adapter) return 'webgpu'
    } catch {
      // WebGPU not usable; fall through to WASM.
    }
  }
  return 'wasm'
}

/** Fetch a model URL and create an InferenceSession. */
async function loadModel(
  url: string,
  ep: 'webgpu' | 'wasm',
): Promise<ort.InferenceSession> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`)
  }
  const buffer = await response.arrayBuffer()
  return ort.InferenceSession.create(buffer, {
    executionProviders: ep === 'webgpu' ? ['webgpu', 'wasm'] : ['wasm'],
  })
}

// ---------------------------------------------------------------------------
// Message handlers
// ---------------------------------------------------------------------------

async function handleLoad(urls: ModelUrls): Promise<void> {
  actualExecutionProvider = config.executionProvider === 'webgpu'
    ? await detectExecutionProvider()
    : 'wasm'

  try {
    melSession = await loadModel(urls.melspectrogram, actualExecutionProvider)
    embedSession = await loadModel(urls.embedding, actualExecutionProvider)
    classifierSession = await loadModel(urls.classifier, actualExecutionProvider)

    // WavLM is optional (Few-Shot scaffold).
    if (urls.wavlm) {
      try {
        wavlmSession = await loadModel(urls.wavlm, actualExecutionProvider)
      } catch {
        // WavLM load failure is non-fatal for traditional KWS.
      }
    }

    post({ type: 'loaded', executionProvider: actualExecutionProvider })
  } catch (err) {
    postError(`Model load failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

function handleConfig(newConfig: KWSConfig): void {
  config = newConfig
  // Update smoother if window size changed.
  if (smoother && newConfig.smoothingWindowFrames !== config.smoothingWindowFrames) {
    smoother = new ScoreSmoother(newConfig.smoothingWindowFrames)
  }
  trigger.configure(
    newConfig.threshold,
    newConfig.minDurationMs,
    newConfig.cooldownMs,
  )
}

async function handleAudio(
  samples: Float32Array,
  capturedAtMs: number,
  vadProbability: number,
): Promise<void> {
  if (!melSession || !embedSession || !classifierSession) return

  // VAD gate: skip inference if VAD is below threshold (ADR-018).
  if (shouldGateByVad(vadProbability, config.vadThreshold, config.vadGateEnabled)) {
    // Still post a low-score sample so the curve doesn't gap.
    const smoothed = smoother.push(0)
    post({
      type: 'score',
      sample: {
        capturedAtMs,
        rawScore: 0,
        smoothedScore: smoothed,
        triggered: false,
        vadProbability,
      },
    })
    return
  }

  // Accumulate audio into the mel window buffer.
  for (let i = 0; i < samples.length; i++) {
    audioBuffer[bufferFill++] = samples[i]
    if (bufferFill >= MEL_WINDOW_SIZE) {
      // Run the inference pipeline.
      try {
        const score = await runInference(audioBuffer)
        const smoothed = smoother.push(score)
        const triggerEvent = trigger.process(smoothed, capturedAtMs)

        post({
          type: 'score',
          sample: {
            capturedAtMs,
            rawScore: score,
            smoothedScore: smoothed,
            triggered: triggerEvent !== null,
            vadProbability,
          },
        })

        if (triggerEvent) {
          post({ type: 'trigger', event: triggerEvent })
        }
      } catch (err) {
        postError(`Inference failed: ${err instanceof Error ? err.message : String(err)}`)
      }

      // Shift the buffer by one hop (10 ms overlap).
      audioBuffer.copyWithin(0, MEL_HOP_SIZE, MEL_WINDOW_SIZE)
      bufferFill = MEL_WINDOW_SIZE - MEL_HOP_SIZE
    }
  }
}

/** Run the melspectrogram -> speech-embedding -> classifier pipeline.
 *
 * The hey-buddy model I/O (benjamin-paine/hey-buddy, CC-BY-4.0):
 *   1. mel-spectrogram.onnx:  [1, samples] -> [time, 1, mel_dim, 32]
 *   2. speech-embedding.onnx:  [batch, 76, 32, 1] -> [batch, 1, 1, 96]
 *   3. classifier (hey-buddy.onnx): [1, 16, 96] -> [1, 1] (sigmoid score)
 *
 * We collect 16 consecutive embeddings (one per mel time step) before running
 * the classifier.
 */

// Ring buffer of 16 embeddings, each 96-dim.
const EMBEDDING_COUNT = 16
const EMBEDDING_DIM = 96
const embeddingBuffer = new Float32Array(EMBEDDING_COUNT * EMBEDDING_DIM)
let embeddingIndex = 0
let embeddingFilled = false

async function runInference(audio: Float32Array): Promise<number> {
  if (!melSession || !embedSession || !classifierSession) return 0

  // Step 1: melspectrogram - [1, samples] -> [time, 1, mel_dim, 32]
  const melInputName = melSession.inputNames[0]
  const audioTensor = new ort.Tensor('float32', audio, [1, audio.length])
  const melOutputs = await melSession.run({ [melInputName]: audioTensor })
  const melOutputName = melSession.outputNames[0]
  const melFeatures = melOutputs[melOutputName] as ort.Tensor
  // melFeatures shape: [time, 1, mel_dim, 32]. We need to reshape to
  // [time, 76, 32, 1] for the embedding model. The mel model outputs `time`
  // frames; each frame is [1, mel_dim, 32] which we transpose to [76, 32, 1].
  const melData = melFeatures.data as Float32Array
  const melShape = melFeatures.dims as number[]
  const melTimeSteps = melShape[0]

  // Step 2: speech-embedding - for each mel time step, extract an embedding.
  // Input: [1, 76, 32, 1], Output: [1, 1, 1, 96]
  const embedInputName = embedSession.inputNames[0]
  const embedOutputName = embedSession.outputNames[0]

  // The mel output [time, 1, mel_dim, 32] - mel_dim should be 76.
  // We process one time step at a time: reshape [1, 76, 32, 1] -> embed -> [1,1,1,96]
  const melDim = melShape[2] // should be 76
  const melFeatureSize = melDim * 32 // 76 * 32 = 2432

  for (let t = 0; t < melTimeSteps; t++) {
    // Extract one time step: [1, mel_dim, 32] -> transpose to [1, 76, 32, 1]
    const melSlice = melData.subarray(t * melFeatureSize, (t + 1) * melFeatureSize)
    // The mel output is [1, mel_dim, 32] per time step. The embedding model
    // expects [batch, 76, 32, 1]. We reshape: the data is already [mel_dim, 32]
    // in row-major, which maps to [76, 32, 1] when we add the channel dim.
    const embedInput = new Float32Array(melFeatureSize)
    embedInput.set(melSlice)
    const embedTensor = new ort.Tensor('float32', embedInput, [1, melDim, 32, 1])
    const embedOutputs = await embedSession.run({ [embedInputName]: embedTensor })
    const embedding = embedOutputs[embedOutputName] as ort.Tensor
    const embedData = embedding.data as Float32Array

    // Push the 96-dim embedding into the ring buffer.
    embeddingBuffer.set(embedData.subarray(0, EMBEDDING_DIM), embeddingIndex * EMBEDDING_DIM)
    embeddingIndex = (embeddingIndex + 1) % EMBEDDING_COUNT
    if (embeddingIndex === 0) embeddingFilled = true
  }

  // Not enough embeddings yet - return 0.
  if (!embeddingFilled) return 0

  // Step 3: classifier - [1, 16, 96] -> [1, 1]
  // Unroll the ring buffer into [1, 16, 96] (oldest first).
  const classifierInput = new Float32Array(EMBEDDING_COUNT * EMBEDDING_DIM)
  for (let i = 0; i < EMBEDDING_COUNT; i++) {
    const srcIdx = ((embeddingIndex + i) % EMBEDDING_COUNT) * EMBEDDING_DIM
    classifierInput.set(
      embeddingBuffer.subarray(srcIdx, srcIdx + EMBEDDING_DIM),
      i * EMBEDDING_DIM,
    )
  }

  const classifierInputName = classifierSession.inputNames[0]
  const classifierTensor = new ort.Tensor('float32', classifierInput, [1, EMBEDDING_COUNT, EMBEDDING_DIM])
  const classifierOutputs = await classifierSession.run({
    [classifierInputName]: classifierTensor,
  })
  const classifierOutputName = classifierSession.outputNames[0]
  const scores = classifierOutputs[classifierOutputName] as ort.Tensor
  const scoreData = scores.data as Float32Array

  // The classifier outputs [1, 1] - a single score (sigmoid probability).
  const raw = scoreData[0]
  return raw < 0 ? 1 / (1 + Math.exp(-raw)) : Math.max(0, Math.min(1, raw))
}

async function handleEmbed(
  requestId: number,
  samples: Float32Array,
  sampleRate: number,
): Promise<void> {
  // WavLM expects 16 kHz mono. The AFE output is already 16 kHz, so no
  // resampling is needed in v1. The sampleRate param is part of the embed
  // contract for future use.
  void sampleRate

  if (!wavlmSession) {
    postError('WavLM model not loaded; embed() unavailable.')
    return
  }

  try {
    // WavLM expects 16 kHz mono. If the input is at a different rate, the caller
    // is responsible for resampling (the AFE output is already 16 kHz).
    const inputName = wavlmSession.inputNames[0]
    const inputTensor = new ort.Tensor('float32', samples, [1, samples.length])
    const outputs = await wavlmSession.run({ [inputName]: inputTensor })
    const outputName = wavlmSession.outputNames[0]
    const embedding = outputs[outputName] as ort.Tensor
    post({ type: 'embed-result', requestId, embedding: embedding.data as Float32Array })
  } catch (err) {
    postError(`Embed failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

// ---------------------------------------------------------------------------
// Worker entry point
// ---------------------------------------------------------------------------

self.onmessage = async (e: MessageEvent<KWSWorkerMessage>) => {
  const msg = e.data
  try {
    switch (msg.type) {
      case 'load':
        await handleLoad(msg.models)
        break
      case 'config':
        handleConfig(msg.config)
        break
      case 'audio':
        await handleAudio(msg.samples, msg.capturedAtMs, msg.vadProbability)
        break
      case 'embed':
        await handleEmbed(msg.requestId, msg.samples, msg.sampleRate)
        break
      case 'stop':
        melSession = null
        embedSession = null
        classifierSession = null
        wavlmSession = null
        bufferFill = 0
        smoother.reset()
        trigger.reset()
        break
    }
  } catch (err) {
    postError(`Worker error: ${err instanceof Error ? err.message : String(err)}`)
  }
}

// (sampleRate is part of the embed contract but WavLM assumes 16 kHz input;
// the AFE output is already 16 kHz, so no resampling is needed in v1.)
