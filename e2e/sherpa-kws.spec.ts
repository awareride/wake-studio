import { test, expect } from '@playwright/test'

/**
 * Verifies the sherpa-onnx KWS WebAssembly backend actually boots in the
 * browser: the wasm runtime initializes and the KeywordSpotter is created
 * (the engine leaves the idle/loading state and becomes ready). Audio capture
 * is not required for loading, so the fake-media device is sufficient.
 *
 * This exercises the full load path end-to-end:
 *   KWSPanel -> KWSEngine.load -> worker handleLoad -> SherpaOnnxKwsBackend
 *   -> inject sherpa-onnx-kws.js + wasm -> Module.onRuntimeInitialized
 *   -> createKws(Module, config) -> 'loaded' message -> status 'ready'.
 */
test('sherpa-onnx-kws backend loads (wasm boots + spotter created)', async ({
  page,
}) => {
  await page.goto('/')

  // Pick the sherpa-onnx-kws backend before loading (now in the top controls).
  const backendSelect = page.locator('select').filter({
    has: page.locator('option[value="sherpa-onnx-kws"]'),
  })
  await expect(backendSelect).toBeVisible()
  await backendSelect.selectOption('sherpa-onnx-kws')

  const loadButton = page.getByRole('button', { name: /Load KWS models/i })
  await expect(loadButton).toBeVisible()

  await loadButton.click()

  // The load button hides immediately (status -> 'loading'), but the wasm must
  // actually boot and the KeywordSpotter must be created before the engine is
  // 'ready'. The 'EP: WASM' label only renders at status === 'ready', proving
  // the worker posted 'loaded'. The wasm bundle is ~55 MB, so allow a generous
  // timeout.
  const epLabel = page.getByText('EP: WASM')
  await expect(epLabel).toBeVisible({ timeout: 180_000 })

  // Any load failure surfaces an error message instead of reaching ready.
  const errorText = page.getByText(/Failed to load|not found|timed out/i)
  await expect(errorText).toBeHidden()
})
