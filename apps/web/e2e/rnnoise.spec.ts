import { test, expect } from '@playwright/test'

/**
 * RNNoise module - L3 browser test (ADR-026).
 *
 * Verifies the ADR-025 pilot: the module's playground route loads, the RNNoise
 * wasm boots in the browser, and processing a frame updates the VAD readout.
 */

test('RNNoise playground loads and processes a frame', async ({ page }) => {
  // Navigate directly to the module playground route (hash deep link).
  await page.goto('/#/playground/rnnoise')

  // The module's own heading is visible.
  await expect(
    page.getByRole('heading', { name: /RNNoise module playground/i }),
  ).toBeVisible()

  // Process one frame and verify the VAD readout updates.
  const processButton = page.getByRole('button', { name: /Process one frame/i })
  await expect(processButton).toBeEnabled({ timeout: 30_000 })

  // VAD stat card (third stat card: label 'VAD' + UiBar; NOT the 'VAD
  // history' curve card above it).
  const vadCard = page
    .locator('div.rounded-lg')
    .filter({ hasText: 'VAD' })
    .filter({ hasNotText: 'history' })
    .first()
  await expect(vadCard).toContainText('VAD')

  // Before processing, the UiBar fill is 0% (inline style width).
  const fill = vadCard.locator('.h-full.rounded-full')
  await expect(fill).toHaveAttribute('style', /width: 0%/)

  await processButton.click()

  // After processing, a real frame always produces a non-zero VAD, so the
  // UiBar fill grows past 0%.
  await expect(fill).not.toHaveCSS('width', '0%', { timeout: 5_000 })
})
