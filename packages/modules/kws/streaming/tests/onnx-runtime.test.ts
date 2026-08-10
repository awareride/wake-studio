/**
 * kws-streaming - L2 runtime test (ADR-026): boot the REAL exported model.
 *
 * L1 covers the state machine with fakes. This layer answers the question L1
 * cannot: does the artifact the CI build produced actually load and score in a
 * real onnxruntime session, driven through the KWSBackend interface exactly as
 * the browser worker drives it?
 *
 * Skipped (not failed) when the artifact is absent, so a fresh clone without
 * `node scripts/fetch-artifact.mjs kws-streaming` still gets a green suite.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { validateManifest } from '../core/manifest'
import { selectLabelScore, softmax } from '../core/streaming'

const ASSETS = resolve(__dirname, '../assets/kws-streaming')
const MODEL = resolve(ASSETS, 'kwt1.onnx')
const MANIFEST = resolve(ASSETS, 'kwt1.json')
const available = existsSync(MODEL) && existsSync(MANIFEST)

describe.skipIf(!available)('kws-streaming L2: real kwt1 artifact', () => {
  let ort: typeof import('onnxruntime-node')
  let session: import('onnxruntime-node').InferenceSession
  const manifest = available
    ? validateManifest(JSON.parse(readFileSync(MANIFEST, 'utf8')))
    : null

  beforeAll(async () => {
    ort = await import('onnxruntime-node')
    session = await ort.InferenceSession.create(MODEL)
  }, 120_000)

  it('the sidecar manifest validates', () => {
    expect(manifest).not.toBeNull()
    expect(manifest!.mode).toBe('sliding-window')
    expect(manifest!.model).toBe('kws_transformer')
    expect(manifest!.labels).toHaveLength(12)
    expect(manifest!.windowSamples).toBe(16000)
  })

  it('the manifest matches the real graph (names + geometry)', () => {
    // This is the check that catches a manifest/model mismatch before the
    // browser does - the driver performs the same assertion at load().
    expect(session.inputNames).toContain(manifest!.audioInput)
    expect(session.outputNames).toContain(manifest!.scoreOutput)
  })

  it('scores a 1 s window and returns 12 finite logits', async () => {
    const audio = new Float32Array(manifest!.windowSamples!)
    // A quiet 440 Hz tone: not a word, but exercises the in-graph MFCC path
    // with real (non-zero) numbers.
    for (let i = 0; i < audio.length; i++) {
      audio[i] = 0.05 * Math.sin((2 * Math.PI * 440 * i) / manifest!.sampleRate)
    }
    const feeds = {
      [manifest!.audioInput]: new ort.Tensor('float32', audio, [1, audio.length]),
    }
    const out = await session.run(feeds)
    const logits = out[manifest!.scoreOutput].data as Float32Array
    expect(logits).toHaveLength(12)
    expect([...logits].every(Number.isFinite)).toBe(true)

    // The driver's selection path must produce a usable probability.
    const score = selectLabelScore(manifest!, logits, 'yes')
    expect(score).toBeGreaterThanOrEqual(0)
    expect(score).toBeLessThanOrEqual(1)

    // Probabilities must be a distribution (the graph emits logits:
    // softmaxed=false), which is what makes the threshold meaningful.
    const probs = softmax(logits)
    const sum = [...probs].reduce((a, b) => a + b, 0)
    expect(sum).toBeCloseTo(1, 5)
  }, 60_000)

  it('does not fire a wake word on silence', async () => {
    const feeds = {
      [manifest!.audioInput]: new ort.Tensor(
        'float32',
        new Float32Array(manifest!.windowSamples!),
        [1, manifest!.windowSamples!],
      ),
    }
    const out = await session.run(feeds)
    const logits = out[manifest!.scoreOutput].data as Float32Array
    const probs = softmax(logits)
    // Every real word (non-underscore label) must stay well below threshold.
    const wordProbs = manifest!.labels
      .map((l, i) => ({ l, p: probs[i] }))
      .filter(({ l }) => !l.startsWith('_'))
    for (const { l, p } of wordProbs) {
      expect(p, `silence scored ${l} at ${p}`).toBeLessThan(0.5)
    }
  }, 60_000)
})

describe.skipIf(available)('kws-streaming L2 (artifact absent)', () => {
  it('explains how to fetch the artifact', () => {
    expect(pathToFileURL(ASSETS).href).toContain('assets/kws-streaming')
    console.warn(
      '[kws-streaming L2] skipped: run `node scripts/fetch-artifact.mjs kws-streaming`',
    )
  })
})
