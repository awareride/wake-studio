import { test, expect } from '@playwright/test'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { enableKws } from './helpers'

// The openwakeword onnx assets are gitignored (ADR-011) and copied into the
// module assets dir by hand from the upstream release; in CI they are absent
// unless fetched. Skip the spec when they are missing (like the sherpa spec)
// rather than failing the suite.
const here = dirname(fileURLToPath(import.meta.url))
const melOnnx = resolve(
  here,
  '..',
  '..',
  '..',
  'packages',
  'modules',
  'kws',
  'openwakeword',
  'assets',
  'openWakeWord',
  'melspectrogram.onnx',
)
const SKIP_REASON = existsSync(melOnnx)
  ? null
  : 'openwakeword onnx assets not present (gitignored); copy them from the upstream release'

/**
 * OpenWakeWord KWS backend - L3 browser test (ADR-026).
 *
 * Regression test for issue #23: the KWS worker bundle must register the
 * driver backends so `createBackend('openwakeword')` resolves inside the
 * worker. Before the fix, this flow failed with:
 *   "[KWS worker] Model load failed: Unknown KWS backend: openwakeword"
 *
 * The mel-spectrogram + speech-embedding onnx assets are local
 * (`/modules/kws/openwakeword/assets/...`, copied into dist by the vite
 * build, ADR-025). The classifier (hey-buddy) is remote (CC-BY-4.0,
 * huggingface.co) per ADR-018 Q-KWS-1, so this spec requires network to reach
 * Hugging Face; if the remote fetch fails, the load surfaces a visible error
 * instead of hanging.
 */

test('openwakeword backend loads in the browser (worker registration works)', async ({
  page,
}) => {
  test.skip(Boolean(SKIP_REASON), SKIP_REASON ?? '')
  // Three onnx fetches (two local ~1 MB, one remote ~? MB) + onnxruntime
  // wasm; allow generous time for cold load.
  test.setTimeout(180_000)
  await page.goto('/')
  await enableKws(page)

  // The default backend is openwakeword; make sure the select shows it.
  const backendSelect = page.locator('select').filter({
    has: page.locator('option[value="openwakeword"]'),
  })
  await expect(backendSelect).toBeVisible()
  await backendSelect.selectOption('openwakeword')

  const loadButton = page.getByRole('button', { name: /Load models/i })
  await expect(loadButton).toBeVisible()
  await loadButton.click()

  // Success path: the engine reaches 'ready' and the 'EP: WASM'/'EP: WebGPU'
  // label renders (status === 'ready' proves the worker posted 'loaded',
  // which requires createBackend('openwakeword') to have succeeded inside the
  // worker).
  const epLabel = page.getByText(/EP: (WASM|WebGPU)/)
  await expect(epLabel).toBeVisible({ timeout: 150_000 })

  // Any load failure (e.g. remote classifier unreachable) surfaces an error
  // message instead of the ready state.
  const errorText = page.getByText(/Failed to load|not found|timed out/i)
  await expect(errorText).toBeHidden()
})

test('reload after stop re-boots the backend (worker recreate)', async ({ page }) => {
  test.skip(Boolean(SKIP_REASON), SKIP_REASON ?? '')
  test.setTimeout(180_000)
  await page.goto('/')

  await enableKws(page)

  const backendSelect = page.locator('select').filter({
    has: page.locator('option[value="openwakeword"]'),
  })
  await backendSelect.selectOption('openwakeword')

  // First load -> ready.
  await page.getByRole('button', { name: /Load models/i }).click()
  await expect(page.getByText(/EP: (WASM|WebGPU)/)).toBeVisible({ timeout: 150_000 })

  // Stop detection (idle -> ready state preserved in the UI).
  const stopButton = page.getByRole('button', { name: /Stop detection/i })
  if (await stopButton.isVisible()) await stopButton.click()

  // Reload: the engine must tear down the old worker and boot a fresh one.
  // Previously the ready-guard in KWSEngine.load() kept the stale worker and
  // the Reload silently did nothing (detection then failed).
  await page.getByRole('button', { name: /Reload models/i }).click()
  await expect(page.getByText(/EP: (WASM|WebGPU)/)).toBeVisible({ timeout: 150_000 })

  const errorText = page.getByText(/Failed to load|not found|timed out/i)
  await expect(errorText).toBeHidden()
})
