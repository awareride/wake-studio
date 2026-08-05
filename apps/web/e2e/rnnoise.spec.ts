import { test, expect } from '@playwright/test'

/**
 * RNNoise module - L3 browser test (ADR-026).
 *
 * Verifies the ADR-025 pilot: the module's playground route loads, the RNNoise
 * wasm boots in the browser, and processing a frame updates the VAD readout.
 */

test('RNNoise playground loads and processes a frame', async ({ page }) => {
  await page.goto('/')

  // Open the playground from the console hero.
  const playgroundButton = page.getByRole('button', {
    name: /RNNoise module playground/i,
  })
  await expect(playgroundButton).toBeVisible()
  await playgroundButton.click()

  // The module's own heading is visible.
  await expect(
    page.getByRole('heading', { name: /RNNoise module playground/i }),
  ).toBeVisible()

  // Process one frame and verify the VAD readout updates.
  const processButton = page.getByRole('button', { name: /Process one frame/i })
  await expect(processButton).toBeEnabled({ timeout: 30_000 })

  // VAD is rendered in the third stat card; start at 0.000.
  const vadCard = page.locator('div.rounded-lg').nth(2)
  await expect(vadCard).toContainText('0.000')

  await processButton.click()

  // After processing, VAD should be a value in [0,1] - assert the text is no
  // longer exactly "0.000" (a real frame always produces a non-zero VAD).
  await expect(vadCard).not.toContainText('0.000', { timeout: 5_000 })
})
