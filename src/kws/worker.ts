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
  'alexa',
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

/** Run the melspectrogram -> embedding -> classifier pipeline. */
async function runInference(audio: Float32Array): Promise<number> {
  if (!melSession || !embedSession || !classifierSession) return 0

  // Step 1: melspectrogram.
  const melInputName = melSession.inputNames[0]
  const audioTensor = new ort.Tensor('float32', audio, [1, audio.length])
  const melOutputs = await melSession.run({ [melInputName]: audioTensor })
  const melOutputName = melSession.outputNames[0]
  const melFeatures = melOutputs[melOutputName] as ort.Tensor

  // Step 2: embedding.
  const embedInputName = embedSession.inputNames[0]
  const embedOutputs = await embedSession.run({ [embedInputName]: melFeatures })
  const embedOutputName = embedSession.outputNames[0]
  const embedding = embedOutputs[embedOutputName] as ort.Tensor

  // Step 3: classifier -> score.
  const classifierInputName = classifierSession.inputNames[0]
  const classifierOutputs = await classifierSession.run({
    [classifierInputName]: embedding,
  })
  const classifierOutputName = classifierSession.outputNames[0]
  const scores = classifierOutputs[classifierOutputName] as ort.Tensor

  // The classifier outputs [background_score, positive_score] or a single score.
  // Take the positive class (last element) or the single output.
  const scoreData = scores.data as Float32Array
  if (scoreData.length >= 2) {
    // Softmax the last two logits and take the positive probability.
    const bg = scoreData[scoreData.length - 2]
    const pos = scoreData[scoreData.length - 1]
    const maxLogit = Math.max(bg, pos)
    const expBg = Math.exp(bg - maxLogit)
    const expPos = Math.exp(pos - maxLogit)
    return expPos / (expBg + expPos)
  }
  // Single output: assume it's already a probability (possibly sigmoid).
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
