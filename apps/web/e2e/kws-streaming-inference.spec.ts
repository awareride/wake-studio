import { test, expect } from '@playwright/test'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
// Ambient `window.kwsHarness` declaration shared with the harness page.
import type {} from '../e2e-fixtures/harness'

/**
 * kws-streaming INFERENCE in a real browser - not just loading.
 *
 * Why this spec exists: the original e2e asserted the engine reached `ready`,
 * which only proves a session was created. It passed happily while EVERY
 * `run()` threw:
 *
 *   Squeeze: "Dimension of input 2 must be 1 instead of 64. shape={1,1,64}"
 *
 * Cause: onnxruntime-web's WebGPU (jsep) EP mis-executes the graph's
 * Slice->Squeeze (CLS-token extraction) - it ignores the `axes` input. The
 * engine's global `executionProvider` defaults to `webgpu`, so the browser took
 * the broken path while Node (onnxruntime-node, wasm) ran the same graph fine.
 *
 * Lesson encoded here: "the model loaded" is NOT evidence of working inference.
 *
 * Runs against the bundled harness page (built only with E2E_HARNESS=1) so it
 * drives the real driver the app ships, not a re-implementation.
 */

const here = dirname(fileURLToPath(import.meta.url))
const assets = resolve(
  here, '..', '..', '..', 'packages', 'modules', 'kws', 'streaming', 'assets', 'kws-streaming',
)
const HARNESS = '/e2e-fixtures/kws-streaming-harness.html'
const missingArtifact = !existsSync(resolve(assets, 'kwt1.onnx'))

test.describe('kws-streaming inference (L3)', () => {
  test.skip(
    missingArtifact,
    'kws-streaming artifact not present; run `node scripts/fetch-artifact.mjs kws-streaming`',
  )

  test.beforeEach(async ({ page }) => {
    const res = await page.goto(HARNESS)
    test.skip(
      !res || res.status() === 404,
      'harness page not built; build/preview with E2E_HARNESS=1',
    )
    await page.waitForFunction(() => Boolean(window.kwsHarness), { timeout: 30_000 })
  })

  test('the driver infers and pins wasm even when WebGPU is requested', async ({
    page,
  }) => {
    test.setTimeout(240_000)
    const out = await page.evaluate(() => window.kwsHarness.driveBackend('kwt1', 'webgpu'))

    expect(out.error ?? '', 'driver threw').toBe('')
    // The fix: WebGPU was requested; WASM must be what actually runs, because
    // the jsep EP mis-executes this graph's Squeeze.
    expect(out.reportedEp).toBe('wasm')
    // A real score must come out. `null` forever means inference never ran -
    // exactly how the bug hid behind a "ready" engine.
    expect(out.score, 'no score was ever produced').not.toBeNull()
    expect(out.score!).toBeGreaterThanOrEqual(0)
    expect(out.score!).toBeLessThanOrEqual(1)
    expect(out.labelCount).toBe(12)
    // The 1 s window / 100 ms hop means the first score arrives well within
    // ~110 frames; a much larger number would mean the warmup logic regressed.
    expect(out.framesToScore).not.toBeNull()
    expect(out.framesToScore!).toBeLessThanOrEqual(120)
  })

  test('an explicit wasm request also infers', async ({ page }) => {
    test.setTimeout(240_000)
    const out = await page.evaluate(() => window.kwsHarness.driveBackend('kwt1', 'wasm'))
    expect(out.error ?? '').toBe('')
    expect(out.reportedEp).toBe('wasm')
    expect(out.score).not.toBeNull()
  })
})
