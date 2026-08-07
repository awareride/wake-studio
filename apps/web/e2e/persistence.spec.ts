import { test, expect } from '@playwright/test'

/**
 * Per-stage persistence (epic #53 P5) - L3 browser test.
 *
 * Enables the raw-input persistence stage (Step D), starts the unified
 * pipeline, captures a short window, and verifies the captured clip lands in
 * the saved-clips replay list (IndexedDB-backed).
 */

test('persistence panel captures a clip after a short run', async ({ page }) => {
  await page.goto('/#/workspace')

  // Step D: enable the raw-input persistence stage.
  const rawToggle = page.getByRole('checkbox', { name: /Raw input/ })
  await rawToggle.check()

  // Start the unified pipeline (KWS off by default -> AFE only).
  await page.getByRole('button', { name: /Start pipeline/ }).click()

  // Capture becomes enabled once the pipeline is running.
  const captureBtn = page.getByRole('button', { name: 'Capture' })
  await expect(captureBtn).toBeEnabled({ timeout: 15_000 })

  await captureBtn.click()
  await expect(
    page.getByRole('button', { name: /Stop & save clips/ }),
  ).toBeVisible()

  // Let ~1.2 s of audio stream, then stop + save.
  await page.waitForTimeout(1200)
  await page.getByRole('button', { name: /Stop & save clips/ }).click()

  // The saved-clips list shows the Raw input clip (named raw-<HH:MM:SS>).
  await expect(page.getByText('Saved clips')).toBeVisible()
  await expect(page.getByText(/raw-\d{2}:\d{2}:\d{2}/)).toBeVisible()
})
