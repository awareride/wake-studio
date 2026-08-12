import { test, expect } from '@playwright/test'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { enableKws } from './helpers'

// The ~53 MB wasm is gitignored (ADR-011) and fetched in CI; skip the spec
// when it is absent (e.g. a fetch failure) rather than fail the suite.
const here = dirname(fileURLToPath(import.meta.url))
const sherpaWasm = resolve(
  here,
  '..',
  '..',
  '..',
  'packages',
  'modules',
  'kws',
  'sherpa',
  'assets',
  'sherpa-onnx-kws',
  'sherpa-onnx-wasm-kws-main.wasm',
)
const SKIP_REASON = existsSync(sherpaWasm)
  ? null
  : 'sherpa-onnx KWS wasm not present; run `node scripts/fetch-artifact.mjs kws-sherpa`'

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
  test.skip(Boolean(SKIP_REASON), SKIP_REASON ?? '')
  // The ~53 MB wasm boot can take > 30 s; the default test timeout (30 s)
  // would fire before the 'ready' assertion. Extend per-test.
  test.setTimeout(240_000)
  await page.goto('/')
  await enableKws(page)

  // Pick the sherpa-onnx-kws backend before loading (now in the top controls).
  const backendSelect = page.locator('select').filter({
    has: page.locator('option[value="sherpa-onnx-kws"]'),
  })
  await expect(backendSelect).toBeVisible()
  await backendSelect.selectOption('sherpa-onnx-kws')

  // The sherpa driver is a list-kind provisioning backend (ADR-033): the
  // Engine card shows its list-load action ('Load with keyword list') instead
  // of the generic 'Load models' (KWSPanel, #79 rewrite).
  const loadButton = page.getByRole('button', { name: /Load with keyword list/i })
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
