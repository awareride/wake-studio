import { test, expect } from '@playwright/test'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// The plix onnx assets are gitignored (ADR-011); skip when absent (like the
// sherpa/openwakeword specs) so CI does not fail on a bare checkout.
const here = dirname(fileURLToPath(import.meta.url))
const plixSmallOnnx = resolve(
  here,
  '..',
  '..',
  '..',
  'packages',
  'modules',
  'kws',
  'plix',
  'assets',
  'plixkws-small.onnx',
)
const SKIP_REASON = existsSync(plixSmallOnnx)
  ? null
  : 'plix onnx assets not present (gitignored); run `node scripts/fetch-artifact.mjs kws-plix`'

/**
 * PLiX encoder - L3 browser test (ADR-026), part of issue #47 acceptance.
 *
 * Regression test for issue #23 in the Few-Shot path: the worker must
 * register the plix driver (embed-provider factory) so the encoder loads
 * inside the worker bundle. Before the fix, the encoder load failed with
 * "Unknown KWS backend" / "PLiX encoder not loaded".
 *
 * Uses the 'small' variant whose ONNX + external-data assets are committed
 * under packages/modules/kws/plix/assets/ (served at
 * /modules/kws/plix/assets/...). The default 'base' variant's onnx asset is
 * not committed (issue #48), so this spec selects 'small' first.
 */

test('plixkws encoder loads in the browser (worker registration works)', async ({
  page,
}) => {
  test.skip(Boolean(SKIP_REASON), SKIP_REASON ?? '')
  test.setTimeout(180_000)
  await page.goto('/')

  // Switch to the plixkws backend.
  const backendSelect = page.locator('select').filter({
    has: page.locator('option[value="plixkws"]'),
  })
  await expect(backendSelect).toBeVisible()
  await backendSelect.selectOption('plixkws')

  // The plix driver config panel renders the encoder variant + runtime
  // (Radix selects, exposed as comboboxes). Pick the 'small' variant whose
  // assets are committed.
  const encoderSelect = page
    .getByRole('combobox')
    .filter({ hasText: /PLiX base/ })
    .first()
  await expect(encoderSelect).toBeVisible()
  await encoderSelect.click()
  await page.getByRole('option', { name: /PLiX small/ }).click()

  // Load the encoder (embed-only path).
  const loadButton = page.getByRole('button', { name: /Load PLiX encoder/i })
  await expect(loadButton).toBeVisible()
  await loadButton.click()

  // Success: engine reaches 'ready' and the "PLiX encoder loaded — record
  // samples to enroll" hint renders.
  const readyHint = page.getByText(/PLiX encoder loaded/i)
  await expect(readyHint).toBeVisible({ timeout: 150_000 })

  // Any load failure surfaces an error instead.
  const errorText = page.getByText(/Encoder load failed|Failed to load|not found/i)
  await expect(errorText).toBeHidden()
})
