import { test, expect } from '@playwright/test'

/**
 * Per-stage persistence (epic #53 P5) - L3 browser test.
 *
 * Enables raw-input persistence in the Source config tab (Step D), starts the
 * unified pipeline (which swaps the config tabs for the run dashboard), and
 * verifies the captured clip lands in the saved-clips list (IndexedDB).
 */

test('persistence: config tab gates capture, clip appears after a short run', async ({ page }) => {
  await page.goto('/#/workspace')

  // Step D: enable raw-input persistence (Source tab is active by default).
  const rawToggle = page.getByRole('checkbox', { name: /raw input/i })
  await rawToggle.check()

  // Start the unified pipeline (KWS off by default -> AFE only).
  await page.getByRole('button', { name: /Start pipeline/ }).click()

  // Config tabs are replaced by the run dashboard.
  await expect(page.getByText('Live')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('Setup')).toBeHidden()

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
