import { test, expect } from '@playwright/test'

test('app shell renders the pipeline', async ({ page }) => {
  await page.goto('/')

  await expect(page).toHaveTitle('WaveStudio')
  await expect(page.getByRole('heading', { name: /From wake-word idea/i })).toBeVisible()

  // The four pipeline stages are rendered (ADR-001).
  await expect(page.getByText('Acoustic Echo Cancellation')).toBeVisible()
  await expect(page.getByText('Blind Source Separation')).toBeVisible()
  await expect(page.getByText('Noise Suppression')).toBeVisible()
  await expect(page.getByText('Keyword Spotting')).toBeVisible()
})
