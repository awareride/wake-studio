/**
 * kws-plix driver module - L2 onnx-runtime test (ADR-026, #48).
 *
 * Boots the PLiX small ONNX encoder in Node (onnxruntime-web) and runs the
 * shared acoustic front-end (melSpectrogram -> fitFrames, raw magnitude as
 * the graph logs internally) + one forward pass: a synthetic 16 kHz clip ->
 * 1280-dim embedding. Asserts the output is finite, non-zero, and of the
 * right dimensionality (PLIX_EMBEDDING_DIM).
 *
 * The assets are gitignored per ADR-011 (fetch with `pnpm fetch:all`); the
 * suite skips when they are absent so CI stays green without them.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as ort from 'onnxruntime-web'
import {
  PLIX_SAMPLE_RATE,
  PLIX_WINDOW_LENGTH,
  PLIX_HOP_LENGTH,
  PLIX_N_MELS,
  PLIX_TARGET_FRAMES,
  melSpectrogram,
  fitFrames,
} from '../encoders/plix-frontend'

const here = dirname(fileURLToPath(import.meta.url))
const MODEL_PATH = resolve(here, '../assets/plixkws-small.onnx')
const DATA_PATH = resolve(here, '../assets/plixkws-small.onnx.data')

const ASSETS_PRESENT = existsSync(MODEL_PATH) && existsSync(DATA_PATH)

describe.skipIf(!ASSETS_PRESENT)('plix onnx encoder runtime (L2, Node)', () => {
  let session: ort.InferenceSession
  let inputName: string

  beforeAll(async () => {
    // Mirror the browser encoder's external-data handling
    // (encoders/plix-onnx.ts): the small export stores its weights in a
    // co-located plixkws-small.onnx.data; pass them explicitly (Node can
    // also read them from disk, but the explicit path matches the browser
    // session option shape).
    session = await ort.InferenceSession.create(readFileSync(MODEL_PATH), {
      executionProviders: ['wasm'],
      externalData: [{ path: 'plixkws-small.onnx.data', data: readFileSync(DATA_PATH) }],
    })
    inputName = session.inputNames[0]
  }, 90_000)

  it('embeds a synthetic 16 kHz clip into a finite 1280-dim vector', async () => {
    // ~1.05 s of a 440 Hz sine -> 104 mel frames, fit to the 100-frame
    // target the ONNX graph expects ([1, 1, 64, 100]).
    const samples = new Float32Array(17_000)
    for (let i = 0; i < samples.length; i++) {
      samples[i] = Math.sin((2 * Math.PI * 440 * i) / PLIX_SAMPLE_RATE) * 0.5
    }
    let mel = melSpectrogram(samples)
    const numFrames = Math.floor(
      (samples.length - PLIX_WINDOW_LENGTH) / PLIX_HOP_LENGTH + 1,
    )
    mel = fitFrames(mel, numFrames)

    const tensor = new ort.Tensor('float32', mel, [
      1,
      1,
      PLIX_N_MELS,
      PLIX_TARGET_FRAMES,
    ])
    const outputs = await session.run({ [inputName]: tensor })
    const outputName = session.outputNames.includes('embeddings')
      ? 'embeddings'
      : session.outputNames[0]
    const embedding = outputs[outputName] as ort.Tensor
    const data = embedding.data as Float32Array
    // 1280-dim embedding, finite and non-degenerate (a pure sine is not
    // speech, but the encoder must still produce a real vector).
    expect(data.length).toBe(1280)
    expect(data.every((v) => Number.isFinite(v))).toBe(true)
    const norm = Math.sqrt(data.reduce((acc, v) => acc + v * v, 0))
    expect(norm).toBeGreaterThan(0)
  })
})
