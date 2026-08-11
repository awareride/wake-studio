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
import { SlidingWindow, selectLabelScore, softmax } from '../core/streaming'

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

  /**
   * The plumbing test: streaming 10 ms AFE frames through SlidingWindow must
   * present the model the SAME audio as handing it the clip directly.
   *
   * This is where a real bug would hide - an off-by-one in the shift, a wrong
   * alignment, or dropped samples would still produce plausible-looking scores,
   * so "it runs" proves nothing. Comparing against direct inference makes any
   * misalignment a hard failure.
   */
  it('frame-by-frame streaming matches whole-clip inference', async () => {
    const windowSamples = manifest!.windowSamples!
    // A structured signal (chirp): every sample is distinct, so ANY shift or
    // drop changes the model output measurably - unlike a constant tone.
    const clip = new Float32Array(windowSamples)
    for (let i = 0; i < clip.length; i++) {
      const t = i / manifest!.sampleRate
      clip[i] = 0.2 * Math.sin(2 * Math.PI * (200 + 600 * t) * t)
    }

    const runClip = async (audio: Float32Array): Promise<Float32Array> => {
      const out = await session.run({
        [manifest!.audioInput]: new ort.Tensor('float32', audio, [1, audio.length]),
      })
      return out[manifest!.scoreOutput].data as Float32Array
    }

    const direct = await runClip(clip)

    // Feed the identical audio as 100 x 160-sample AFE frames.
    const window = new SlidingWindow(windowSamples, manifest!.hopSamples!)
    const AFE_FRAME = 160
    let lastWindow: Float32Array | null = null
    for (let off = 0; off < clip.length; off += AFE_FRAME) {
      window.push(clip.subarray(off, off + AFE_FRAME))
      const w = window.take()
      if (w) lastWindow = w
    }
    expect(window.primed).toBe(true)
    expect(lastWindow).not.toBeNull()
    // The final window must be byte-identical to the clip.
    expect(lastWindow!.length).toBe(clip.length)
    expect([...lastWindow!]).toEqual([...clip])

    const streamed = await runClip(lastWindow!)
    // Same audio in => same logits out, to floating-point tolerance.
    for (let i = 0; i < direct.length; i++) {
      expect(streamed[i]).toBeCloseTo(direct[i], 4)
    }
  }, 120_000)
})

describe.skipIf(available)('kws-streaming L2 (artifact absent)', () => {
  it('explains how to fetch the artifact', () => {
    expect(pathToFileURL(ASSETS).href).toContain('assets/kws-streaming')
    console.warn(
      '[kws-streaming L2] skipped: run `node scripts/fetch-artifact.mjs kws-streaming`',
    )
  })
})

/**
 * The end-to-end trigger chain: real model + real engine logic.
 *
 * This is the test that would have caught the reported "speaking a keyword
 * never triggers" bug. It drives the SAME ScoreSmoother + TriggerDetector the
 * worker uses, with scores from the REAL model, and 10 ms frame timestamps in
 * the same units the AFE now emits (milliseconds). With the old
 * seconds-valued timestamps this cannot fire.
 */
describe.skipIf(!available)('kws-streaming L2: end-to-end trigger', () => {
  let ort: typeof import('onnxruntime-node')
  let session: import('onnxruntime-node').InferenceSession
  const manifest = available
    ? validateManifest(JSON.parse(readFileSync(MANIFEST, 'utf8')))
    : null

  beforeAll(async () => {
    ort = await import('onnxruntime-node')
    session = await ort.InferenceSession.create(MODEL)
  }, 120_000)

  /**
   * Run the engine pipeline over `durationMs` of audio, scoring once per hop
   * exactly as the driver does.
   *
   * @param msPerFrame timestamp increment per 10 ms frame: 10 = milliseconds
   *   (correct), 0.01 = raw AudioContext seconds (the bug).
   */
  async function pipeline(
    audio: Float32Array,
    durationMs: number,
    msPerFrame: number,
  ): Promise<{ triggers: number; maxScore: number }> {
    const { ScoreSmoother, TriggerDetector } = await import(
      '@wake-studio/module-kws-engine'
    )
    const { DEFAULT_CONFIG } = await import('@wake-studio/module-kws-engine')
    const smoother = new ScoreSmoother(DEFAULT_CONFIG.smoothingWindowFrames)
    const trigger = new TriggerDetector(
      DEFAULT_CONFIG.threshold,
      DEFAULT_CONFIG.minDurationMs,
      DEFAULT_CONFIG.cooldownMs,
    )
    const window = new SlidingWindow(manifest!.windowSamples!, manifest!.hopSamples!)
    const FRAME = 160
    let triggers = 0
    let maxScore = 0
    const frames = durationMs / 10

    for (let f = 0; f < frames; f++) {
      // Loop the clip so the window always holds the keyword.
      const off = (f * FRAME) % audio.length
      const chunk = audio.subarray(off, off + FRAME)
      window.push(
        chunk.length === FRAME ? chunk : new Float32Array(FRAME),
      )
      const w = window.take()
      if (!w) continue
      const out = await session.run({
        [manifest!.audioInput]: new ort.Tensor('float32', w, [1, w.length]),
      })
      const score = selectLabelScore(
        manifest!,
        out[manifest!.scoreOutput].data as Float32Array,
        manifest!.wantedWord,
      )
      maxScore = Math.max(maxScore, score)
      const smoothed = smoother.push(score)
      if (trigger.process(smoothed, f * msPerFrame)) triggers++
    }
    return { triggers, maxScore }
  }

  it('silence produces no trigger (and a low score)', async () => {
    const { triggers, maxScore } = await pipeline(
      new Float32Array(manifest!.windowSamples!),
      1000,
      10,
    )
    expect(maxScore).toBeLessThan(0.5)
    expect(triggers).toBe(0)
  }, 180_000)

  it('a synthetic above-threshold score DOES trigger with ms timestamps', async () => {
    // The model needs real speech to score high, and this suite has no speech
    // fixture (CI validates real audio separately). So assert the chain the
    // bug lived in: given an above-threshold score stream, ms timestamps
    // trigger and seconds-valued ones never do.
    const { ScoreSmoother, TriggerDetector, DEFAULT_CONFIG } = await import(
      '@wake-studio/module-kws-engine'
    )
    const run = (msPerFrame: number): number => {
      const smoother = new ScoreSmoother(DEFAULT_CONFIG.smoothingWindowFrames)
      const trigger = new TriggerDetector(
        DEFAULT_CONFIG.threshold,
        DEFAULT_CONFIG.minDurationMs,
        DEFAULT_CONFIG.cooldownMs,
      )
      let triggers = 0
      for (let f = 0; f < 200; f += 10) {
        const smoothed = smoother.push(0.95)
        if (trigger.process(smoothed, f * msPerFrame)) triggers++
      }
      return triggers
    }
    expect(run(0.01)).toBe(0) // AudioContext seconds - the reported bug
    expect(run(10)).toBeGreaterThan(0) // milliseconds - fixed
  }, 60_000)
})
