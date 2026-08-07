import { test, expect } from '@playwright/test'

/**
 * Config-before-preview step layout (epic #53 P7, plan §8.1).
 *
 * The workspace is grouped into a Phase 1 "Configure" flow (collapsible
 * Steps A–D, before Start) and a Phase 2 "Preview" area (after Start). The
 * KWS configuration step (Step C) renders only when the KWS component toggle
 * is enabled.
 */

test('config steps render; KWS step gated on the KWS component toggle', async ({ page }) => {
  await page.goto('/#/workspace')

  // Phase 1 configure flow is present up front with the Step A/B sections.
  await expect(page.getByText('Phase 1 · Configure')).toBeVisible()
  await expect(page.getByText('Components & input source')).toBeVisible()
  await expect(page.getByText('AFE configuration')).toBeVisible()

  // KWS off by default -> Step C (the KWS panel) is NOT rendered.
  await expect(page.getByText('KWS configuration')).toBeHidden()
  await expect(page.getByText('KWS detection')).toBeHidden()
  await expect(page.getByRole('button', { name: /Load models/i })).toBeHidden()

  // Toggling KWS on gates the step in.
  await page.getByRole('checkbox', { name: 'KWS', exact: true }).check()
  await expect(page.getByText('KWS configuration')).toBeVisible()
  await expect(page.getByText('KWS detection')).toBeVisible()
  await expect(page.getByRole('button', { name: /Load models/i })).toBeVisible()

  // Toggling KWS off removes the step again.
  await page.getByRole('checkbox', { name: 'KWS', exact: true }).uncheck()
  await expect(page.getByText('KWS configuration')).toBeHidden()
  await expect(page.getByText('KWS detection')).toBeHidden()
})
