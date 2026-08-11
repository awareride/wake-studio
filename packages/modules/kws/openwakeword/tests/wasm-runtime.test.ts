/**
 * kws-openwakeword driver module - L2 onnx-runtime test (ADR-026, #45).
 *
 * Boots the three onnx models (melspectrogram -> speech_embedding ->
 * hey-buddy classifier) in Node with onnxruntime-web and runs one synthetic
 * pass through the full pipeline: int16-scaled audio -> mel frames ->
 * 96-dim embedding -> classifier score. Asserts the outputs are finite and
 * of the expected magnitude (classifier score in [0,1], already sigmoid'd).
 *
 * The assets are gitignored per ADR-011 (fetch with `pnpm fetch:all`); the
 * suite skips when they are absent so CI stays green without them.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { existsSync, readFile } from 'node:fs'
import { promisify } from 'node:util'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as ort from 'onnxruntime-web'

const readFileP = promisify(readFile)

const here = dirname(fileURLToPath(import.meta.url))
const assetsDir = resolve(here, '../assets')
const MEL_PATH = resolve(assetsDir, 'openWakeWord/melspectrogram.onnx')
const EMBED_PATH = resolve(assetsDir, 'openWakeWord/embedding_model.onnx')
const CLASSIFIER_PATH = resolve(assetsDir, 'hey-buddy/models/hey-buddy.onnx')

const ASSETS_PRESENT =
  existsSync(MEL_PATH) && existsSync(EMBED_PATH) && existsSync(CLASSIFIER_PATH)

// openwakeword pipeline constants (mirror core/backend.ts).
const EMBEDDING_WINDOW = 76
const EMBEDDING_DIM = 96
const CLASSIFIER_STEPS = 16

async function loadSession(path: string): Promise<ort.InferenceSession> {
  const buffer = await readFileP(path)
  return ort.InferenceSession.create(buffer, { executionProviders: ['wasm'] })
}

describe.skipIf(!ASSETS_PRESENT)('openwakeword onnx runtime (L2, Node)', () => {
  let mel: ort.InferenceSession
  let embed: ort.InferenceSession
  let classifier: ort.InferenceSession

  beforeAll(async () => {
    mel = await loadSession(MEL_PATH)
    embed = await loadSession(EMBED_PATH)
    classifier = await loadSession(CLASSIFIER_PATH)
  }, 90_000)

  it('mel -> embedding -> classifier runs end-to-end on a synthetic clip', async () => {
    // Step 1: mel on 12 800 int16-scaled samples -> [1, 1, time, 32] with
    // time >= 76 frames (the backend scales by 32768 - the mel graph is
    // trained for int16 PCM, see core/backend.ts).
    const samples = new Float32Array(12_800)
    for (let i = 0; i < samples.length; i++) {
      samples[i] = Math.sin((2 * Math.PI * 440 * i) / 16_000) * 0.5 * 32_768
    }
    const melTensor = new ort.Tensor('float32', samples, [1, samples.length])
    const melOut = await mel.run({ [mel.inputNames[0]]: melTensor })
    const melResult = melOut[mel.outputNames[0]] as ort.Tensor
    const melData = melResult.data as Float32Array
    const melDims = melResult.dims as number[]
    const melTime = melDims[2]
    const melBins = melDims[3]
    expect(melTime).toBeGreaterThanOrEqual(EMBEDDING_WINDOW)
    expect(melBins).toBe(32)

    // Apply the backend's x/10 + 2 mel transform; frames must be finite.
    const frames: Float32Array[] = []
    for (let t = 0; t < melTime; t++) {
      const frame = new Float32Array(melBins)
      for (let b = 0; b < melBins; b++) {
        frame[b] = melData[t * melBins + b] / 10 + 2
      }
      frames.push(frame)
    }
    for (const frame of frames) {
      expect(frame.every((v) => Number.isFinite(v))).toBe(true)
    }

    // Step 2: embedding on the last 76 frames -> [1, 1, 1, 96].
    const embedInput = new Float32Array(EMBEDDING_WINDOW * melBins)
    const startFrame = melTime - EMBEDDING_WINDOW
    for (let i = 0; i < EMBEDDING_WINDOW; i++) {
      embedInput.set(frames[startFrame + i], i * melBins)
    }
    const embedTensor = new ort.Tensor('float32', embedInput, [
      1,
      EMBEDDING_WINDOW,
      melBins,
      1,
    ])
    const embedOut = await embed.run({ [embed.inputNames[0]]: embedTensor })
    const embedResult = embedOut[embed.outputNames[0]] as ort.Tensor
    const embedData = embedResult.data as Float32Array
    expect(embedData.length).toBe(EMBEDDING_DIM)
    expect(embedData.every((v) => Number.isFinite(v))).toBe(true)
    // A pure sine is not speech, but the embedding must not be degenerate
    // (all zeros / NaN).
    const norm = Math.sqrt(embedData.reduce((acc, v) => acc + v * v, 0))
    expect(norm).toBeGreaterThan(0)

    // Step 3: classifier on the 16-embedding receptive field -> [1, 1] score
    // in [0, 1] (sigmoid output). One 76-frame window yields one embedding;
    // tile it 16x to fill the field (boot verification, not detection).
    const classifierInput = new Float32Array(CLASSIFIER_STEPS * EMBEDDING_DIM)
    for (let i = 0; i < CLASSIFIER_STEPS; i++) {
      classifierInput.set(embedData, i * EMBEDDING_DIM)
    }
    const classifierTensor = new ort.Tensor('float32', classifierInput, [
      1,
      CLASSIFIER_STEPS,
      EMBEDDING_DIM,
    ])
    const classifierOut = await classifier.run({
      [classifier.inputNames[0]]: classifierTensor,
    })
    const classifierResult = classifierOut[
      classifier.outputNames[0]
    ] as ort.Tensor
    const score = (classifierResult.data as Float32Array)[0]
    expect(Number.isFinite(score)).toBe(true)
    expect(score).toBeGreaterThanOrEqual(0)
    expect(score).toBeLessThanOrEqual(1)
  })
})
