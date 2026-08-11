import { test, expect } from '@playwright/test'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { enableKws } from './helpers'

// The plix onnx assets are gitignored (ADR-011); skip when absent (like the
// other kws specs) so CI does not fail on a bare checkout.
const here = dirname(fileURLToPath(import.meta.url))
const hfConfig = resolve(
  here,
  '..',
  '..',
  '..',
  'packages',
  'modules',
  'kws',
  'plix',
  'assets',
  'hf',
  'plixkws',
  'config.json',
)
const SKIP_REASON = existsSync(hfConfig)
  ? null
  : 'plix HF-style assets not present (gitignored); run `node scripts/fetch-artifact.mjs kws-plix`'

/**
 * PLiX encoder - 'transformers' runtime browser verification (ADR-026, #48).
 *
 * The 'transformers' runtime (encoders/plix-transformers.ts) loads
 * @huggingface/transformers from the jsDelivr CDN and serves the model from
 * the locally-hosted HF-style dir (assets/hf/plixkws). This spec pins that
 * the non-ONNX path boots to 'ready' in the browser.
 *
 * Requires network access to cdn.jsdelivr.net (the CDN import); on offline
 * CI runners the load surfaces a visible error and this spec fails — if that
 * becomes a problem, move it to merge-gate cadence like the sherpa e2e
 * (issue #33 / Q11).
 */
test('plixkws transformers runtime loads the encoder in the browser (#48)', async ({
  page,
}) => {
  test.skip(Boolean(SKIP_REASON), SKIP_REASON ?? '')
  test.setTimeout(300_000)
  await page.goto('/')
  await enableKws(page)

  const backendSelect = page
    .locator('select')
    .filter({ has: page.locator('option[value="plixkws"]') })
  await expect(backendSelect).toBeVisible()
  await backendSelect.selectOption('plixkws')

  // Switch the driver's runtime param (Radix select) to Transformers.js.
  const runtimeCombobox = page.locator('[role="combobox"]', {
    hasText: 'ONNX (onnxruntime-web)',
  })
  await expect(runtimeCombobox).toBeVisible()
  await runtimeCombobox.click()
  await page.getByText('Transformers.js (browser-native, CDN)').click()
  await expect(
    page.locator('[role="combobox"]', { hasText: 'Transformers.js' }),
  ).toBeVisible({ timeout: 15_000 })

  const loadButton = page.getByRole('button', { name: /Load PLiX encoder/i })
  await expect(loadButton).toBeVisible()
  await loadButton.click()

  // Success: engine reaches 'ready' and the enrollment hint renders.
  await expect(page.getByText(/Encoder loaded — record samples to enroll/)).toBeVisible({
    timeout: 240_000,
  })
  const errorText = page.getByText(/Encoder load failed|Failed to load|not found/i)
  await expect(errorText).toBeHidden()
})
