import { test, expect } from '@playwright/test'

/**
 * Pipeline-shaped config tabs (epic #53 UX overhaul, plan §8.1).
 *
 * The workspace config is a Source → AEC → BSS → NS → KWS tab flow inside
 * Phase 1 · Configure; the run dashboard (Phase 2 · Preview) replaces it
 * after Start. The KWS tab only exists when the KWS component toggle is on.
 */

test('config tabs render; KWS tab gated on the KWS component toggle', async ({ page }) => {
  await page.goto('/#/workspace')

  // Phase 1 configure flow is present up front with the module tabs.
  await expect(page.getByText('Phase 1 · Configure')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Source config' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'AEC config' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'BSS config' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'NS config' })).toBeVisible()

  // KWS off by default -> no KWS tab, no KWS panel.
  await expect(page.getByRole('button', { name: 'KWS config' })).toBeHidden()
  await expect(page.getByText('KWS detection')).toBeHidden()

  // Toggling KWS on gates the tab in.
  await page.getByRole('checkbox', { name: 'KWS', exact: true }).check()
  await expect(page.getByRole('button', { name: 'KWS config' })).toBeVisible()

  // Selecting the KWS tab renders the KWS panel.
  await page.getByRole('button', { name: 'KWS config' }).click()
  await expect(page.getByText('KWS detection')).toBeVisible()

  // Toggling KWS off removes the tab again.
  await page.getByRole('checkbox', { name: 'KWS', exact: true }).uncheck()
  await expect(page.getByRole('button', { name: 'KWS config' })).toBeHidden()
  await expect(page.getByText('KWS detection')).toBeHidden()
})
