/**
 * Test-only harness for the kws-streaming L3 inference spec (ADR-026).
 *
 * Exposes helpers on `window` so Playwright can drive the REAL driver the app
 * ships. This is a bundled module rather than inline `page.evaluate` code
 * because `evaluate` cannot resolve bare module specifiers - and a hand-rolled
 * copy of the inference path would not be evidence about the shipped path.
 *
 * Note it deliberately does NOT import `onnxruntime-web` directly: that runtime
 * belongs to the driver packages, not to apps/web, and adding it here just for a
 * test would duplicate a heavy dependency. Everything goes through the driver's
 * own public surface, which is what we actually want to test.
 *
 * Not referenced by the app; only `kws-streaming-harness.html` loads it, and
 * that page is built only when E2E_HARNESS=1.
 */

import { KWSStreamingBackend } from '@wake-studio/module-kws-streaming'

const BASE = '/modules/kws/streaming/assets/kws-streaming'

export interface DriveResult {
  /** EP the driver actually created the session with. */
  reportedEp: string | null
  /** First non-null score from processFrame, or null if none ever came. */
  score: number | null
  /** How many 10 ms frames were needed before a score appeared. */
  framesToScore: number | null
  /** Number of labels in the loaded manifest. */
  labelCount: number | null
  error?: string
}

/**
 * Load a model through the driver, asking for the EP the caller names, then
 * feed AFE-sized frames until a score appears.
 *
 * Requesting 'webgpu' must still yield a working wasm session: that override is
 * the fix for the reported `Squeeze` failure.
 */
async function driveBackend(
  name: string,
  requestedEp: 'webgpu' | 'wasm' = 'webgpu',
): Promise<DriveResult> {
  const backend = new KWSStreamingBackend()
  try {
    await backend.load(
      {
        kwsStreaming: {
          model: `${BASE}/${name}.onnx`,
          manifest: `${BASE}/${name}.json`,
        },
      },
      requestedEp,
    )
    let score: number | null = null
    let framesToScore: number | null = null
    // 1 s window / 100 ms hop => a score within ~110 frames of 160 samples.
    // A quiet tone keeps the graph's in-model MFCC on real (non-zero) numbers.
    for (let f = 0; f < 300 && score === null; f++) {
      const frame = new Float32Array(160)
      for (let i = 0; i < frame.length; i++) {
        frame[i] = 0.05 * Math.sin((2 * Math.PI * 440 * (f * 160 + i)) / 16000)
      }
      score = await backend.processFrame(frame)
      if (score !== null) framesToScore = f + 1
    }
    return {
      reportedEp: backend.effectiveExecutionProvider,
      score,
      framesToScore,
      labelCount: backend.manifest?.labels.length ?? null,
    }
  } catch (e) {
    return {
      reportedEp: null,
      score: null,
      framesToScore: null,
      labelCount: null,
      error: String((e as Error).message).slice(0, 400),
    }
  } finally {
    await backend.dispose()
  }
}

window.kwsHarness = { driveBackend }

const out = document.getElementById('out')
if (out) out.textContent = 'ready'
