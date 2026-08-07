import { test, expect } from '@playwright/test'

/**
 * Pipeline-shaped stage cards (epic #53 UX).
 *
 * Source → AEC → BSS → NS → KWS render as five evenly-distributed cards,
 * each with its own enable/disable pill (bypass for the AFE stages, on/off
 * for KWS). Selecting a card shows its config panel.
 */

test('stage cards render; KWS toggle gates the KWS stage', async ({ page }) => {
  await page.goto('/#/workspace')

  // Phase 1 configure flow with all five stage cards.
  await expect(page.getByText('Phase 1 · Configure')).toBeVisible()
  for (const name of ['Source & AFE', 'AEC', 'BSS', 'NS', 'KWS']) {
    await expect(page.getByRole('button', { name: `${name} config` })).toBeVisible()
  }

  // KWS starts disabled (card pill Off); its panel is hidden.
  const kwsToggle = page.getByRole('button', { name: 'KWS toggle' })
  await expect(kwsToggle).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByText('KWS detection')).toBeHidden()

  // Selecting the KWS card reveals the panel.
  await page.getByRole('button', { name: 'KWS config' }).click()
  await expect(page.getByText('KWS detection')).toBeVisible()

  // The pill toggles on/off.
  await kwsToggle.click()
  await expect(kwsToggle).toHaveAttribute('aria-pressed', 'true')
  await kwsToggle.click()
  await expect(kwsToggle).toHaveAttribute('aria-pressed', 'false')
})
