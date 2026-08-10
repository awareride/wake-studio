import { test, expect } from '@playwright/test'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { enableKws } from './helpers'

// The exported ONNX graphs are gitignored (ADR-011) and fetched in CI; skip
// rather than fail the suite when they are absent.
const here = dirname(fileURLToPath(import.meta.url))
const assetsDir = resolve(
  here,
  '..',
  '..',
  '..',
  'packages',
  'modules',
  'kws',
  'streaming',
  'assets',
  'kws-streaming',
)
const model = resolve(assetsDir, 'kwt1.onnx')
const manifest = resolve(assetsDir, 'kwt1.json')
const SKIP_REASON =
  existsSync(model) && existsSync(manifest)
    ? null
    : 'kws-streaming artifact not present; run `node scripts/fetch-artifact.mjs kws-streaming`'

/**
 * Verifies the kws-streaming backend loads a PRETRAINED model in a real
 * browser, exercising the whole path:
 *
 *   KWSPanel -> resolveKwsStreamingUrls (registry entry: url + manifestUrl)
 *   -> KWSEngine.load -> worker handleLoad -> backendHasRequiredUrls
 *   -> KWSStreamingBackend.load (fetch manifest, validate, create ONNX session,
 *      cross-check manifest against the graph) -> 'loaded' -> status 'ready'.
 *
 * The manifest/graph cross-check is the valuable part: it means "ready" here
 * proves the artifact and its sidecar actually agree, not merely that a file
 * downloaded.
 */
test('kws-streaming backend loads a pretrained Keyword Transformer model', async ({
  page,
}) => {
  test.skip(Boolean(SKIP_REASON), SKIP_REASON ?? '')
  // ~3.7 MB model + onnxruntime wasm init.
  test.setTimeout(180_000)

  const failures: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') failures.push(msg.text())
  })

  await page.goto('/')
  await enableKws(page)

  const backendSelect = page.locator('select').filter({
    has: page.locator('option[value="kws-streaming"]'),
  })
  await expect(backendSelect).toBeVisible()
  await backendSelect.selectOption('kws-streaming')

  const loadButton = page.getByRole('button', { name: /Load models/i })
  await expect(loadButton).toBeVisible()
  await loadButton.click()

  // The EP label only renders at status === 'ready', i.e. after the worker
  // posted 'loaded' - which happens only if the manifest validated AND matched
  // the graph's real tensor names.
  await expect(page.getByText(/EP: (WASM|WEBGPU)/i)).toBeVisible({
    timeout: 120_000,
  })

  await expect(
    page.getByText(/Failed to load|not found|does not match|timed out/i),
  ).toBeHidden()

  // A manifest/graph mismatch throws inside the worker; assert nothing of the
  // sort reached the console.
  expect(
    failures.filter((f) => /kws-streaming|manifest|onnx/i.test(f)),
  ).toEqual([])
})
