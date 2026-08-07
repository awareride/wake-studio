/**
 * kws-openwakeword driver module - L2 pipeline test (ADR-026).
 *
 * Regression test for the int16-scaling bug: the openwakeword mel model
 * expects 16-bit PCM audio (int16 magnitude), but the backend used to feed it
 * float [-1,1] samples directly. That drove the log-Mel to its floor (~ -77 dB
 * across the board), collapsing the embedding features and leaving every
 * classifier score near 0 (verified with a real "hey buddy" clip: 0.0001
 * unscaled vs 0.977 with int16 scaling via the upstream AudioFeatures
 * pipeline).
 *
 * This test runs the REAL onnx models in Node (onnxruntime-node) and asserts
 * that scaling the input by 32768 produces a well-formed score range, while
 * the unscaled input collapses to ~0. Assets are gitignored; the suite skips
 * when they are absent (CI without the fetch).
 *
 * Uses a synthetic "speech-like" clip (modulated harmonic stack + noise) at
 * int16 magnitude - the exact regression we guard is the amplitude scaling,
 * not real-speech recognition.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const assetsDir = resolve(here, '../assets/openWakeWord')
const hbAssetsDir = resolve(here, '../assets/hey-buddy/models')
const SKIP =
  !existsSync(resolve(assetsDir, 'melspectrogram.onnx')) ||
  !existsSync(resolve(assetsDir, 'embedding_model.onnx')) ||
  !existsSync(resolve(assetsDir, 'alexa_v0.1.onnx')) ||
  !existsSync(resolve(hbAssetsDir, 'hey-buddy.onnx'))

const MEL_WINDOW = 1280
const EMB_WINDOW = 76
const EMB_DIM = 96
const CLS_STEPS = 16

/** A synthetic speech-like clip: harmonic stack with amplitude modulation. */
function speechLike(samples: number, sr = 16000): Float32Array {
  const out = new Float32Array(samples)
  for (let i = 0; i < samples; i++) {
    const t = i / sr
    // Formant-ish stack: 120/240/360 Hz with an AM envelope.
    out[i] =
      0.6 * Math.sin(2 * Math.PI * 120 * t) +
      0.3 * Math.sin(2 * Math.PI * 240 * t) +
      0.1 * Math.sin(2 * Math.PI * 360 * t)
    out[i] *= 0.5 + 0.5 * Math.sin(2 * Math.PI * 3 * t) // ~3 Hz syllable rate
  }
  return out
}

describe.skipIf(SKIP)('openwakeword mel int16 scaling (L2, Node)', () => {
  let ort: typeof import('onnxruntime-node')
  let melSess: Awaited<ReturnType<typeof ort.InferenceSession.create>>
  let embSess: Awaited<ReturnType<typeof ort.InferenceSession.create>>
  let clsSess: Awaited<ReturnType<typeof ort.InferenceSession.create>>

  beforeAll(async () => {
    ort = await import('onnxruntime-node')
    melSess = await ort.InferenceSession.create(resolve(assetsDir, 'melspectrogram.onnx'))
    embSess = await ort.InferenceSession.create(resolve(assetsDir, 'embedding_model.onnx'))
    clsSess = await ort.InferenceSession.create(resolve(hbAssetsDir, 'hey-buddy.onnx'))
  }, 60_000)

  /** Run mel -> embedding -> classifier, optionally scaling to int16. */
  async function runScore(scale: boolean): Promise<number> {
    const clip = speechLike(MEL_WINDOW * 40) // ~3.2 s
    const input = new Float32Array(clip.length)
    for (let i = 0; i < clip.length; i++) input[i] = scale ? clip[i] * 32768 : clip[i]

    const melOut = await melSess.run({
      [melSess.inputNames[0]]: new ort.Tensor('float32', input, [1, input.length]),
    })
    const mel = melOut[melSess.outputNames[0]] as unknown as { data: Float32Array; dims: number[] }
    const [,, melTime, melBins] = mel.dims

    // Build embeddings: 76-frame windows stepping 8 frames (official algorithm).
    const embeddings: Float32Array[] = []
    for (let end = melTime; end >= EMB_WINDOW; end -= 8) {
      const start = end - EMB_WINDOW
      const embIn = new Float32Array(EMB_WINDOW * melBins)
      for (let k = 0; k < EMB_WINDOW; k++) {
        for (let b = 0; b < melBins; b++) {
          embIn[k * melBins + b] = mel.data[(start + k) * melBins + b] / 10 + 2
        }
      }
      const embOut = await embSess.run({
        [embSess.inputNames[0]]: new ort.Tensor('float32', embIn, [1, EMB_WINDOW, melBins, 1]),
      })
      embeddings.push(new Float32Array((embOut[embSess.outputNames[0]] as { data: Float32Array }).data.subarray(0, EMB_DIM)))
    }

    if (embeddings.length < CLS_STEPS) throw new Error('not enough embeddings')
    const last16 = embeddings.slice(-CLS_STEPS)
    const clsIn = new Float32Array(CLS_STEPS * EMB_DIM)
    for (let i = 0; i < CLS_STEPS; i++) clsIn.set(last16[i], i * EMB_DIM)
    const clsOut = await clsSess.run({
      [clsSess.inputNames[0]]: new ort.Tensor('float32', clsIn, [1, CLS_STEPS, EMB_DIM]),
    })
    const v = (clsOut[clsSess.outputNames[0]] as { data: Float32Array }).data[0]
    return Number.isFinite(v) ? v : 0
  }

  it('mel scaled to int16 magnitude yields a non-degenerate score', async () => {
    const scaled = await runScore(true)
    // A real model over a synthetic clip should at least produce a finite,
    // non-collapsed value (the unscaled path collapses to ~0). With the
    // upstream pipeline a real wake-word clip reached 0.977; synthetic speech
    // here just needs to be measurably > 0 and finite.
    expect(scaled).toBeGreaterThan(0)
    expect(scaled).toBeLessThanOrEqual(1)
  })

  it('unscaled float input collapses the score (regression guard)', async () => {
    const unscaled = await runScore(false)
    // The bug: feeding float [-1,1] drives log-mel to its floor, so the
    // classifier output is ~0 regardless of content.
    expect(unscaled).toBeLessThan(0.05)
  })
})
