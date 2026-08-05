import { test, expect } from '@playwright/test'

/**
 * Console shell + workspace smoke tests (Phase 1).
 *
 * The app is now an IDE-style console (left sidebar + hash-routed views).
 * Workspace hosts the live panels (AFE/KWS/Few-Shot/Training) — those still
 * render, but under the new shell.
 */

test('console shell renders: sidebar + workspace default view', async ({ page }) => {
  await page.goto('/')

  await expect(page).toHaveTitle('WakeStudio')

  // Left sidebar with primary nav.
  const sidebar = page.locator('aside')
  await expect(sidebar).toBeVisible()
  await expect(sidebar.getByRole('button', { name: 'Workspace' })).toBeVisible()
  await expect(sidebar.getByRole('button', { name: 'Model Library' })).toBeVisible()
  await expect(sidebar.getByRole('button', { name: 'Projects' })).toBeVisible()

  // Default view is the workspace (h1 in the top bar + main heading). Root
  // path ('/') renders the workspace without rewriting the URL.
  await expect(page.getByRole('main').getByRole('heading', { name: 'Workspace' })).toBeVisible()
})

test('hash routing navigates between views', async ({ page }) => {
  await page.goto('/')

  // Model Library: registry-driven view.
  await sidebarNav(page, 'Model Library')
  await expect(page).toHaveURL(/#\/library/)
  await expect(page.getByRole('heading', { name: /Models \(\d+\)/ })).toBeVisible()

  // Projects scaffold.
  await sidebarNav(page, 'Projects')
  await expect(page).toHaveURL(/#\/projects/)
  await expect(page.getByRole('main').getByRole('heading', { name: 'Projects' })).toBeVisible()

  // Settings placeholder.
  await sidebarNav(page, 'Settings')
  await expect(page).toHaveURL(/#\/settings/)
  await expect(page.getByText('Coming soon')).toBeVisible()

  // Device SDK placeholder.
  await sidebarNav(page, 'Device SDK')
  await expect(page).toHaveURL(/#\/device-sdk/)
  await expect(page.getByText('Coming soon')).toBeVisible()

  // Back to workspace.
  await sidebarNav(page, 'Workspace')
  await expect(page).toHaveURL(/#\/workspace/)
})

test('model library renders registry entries', async ({ page }) => {
  await page.goto('/#/library')

  // Registry is fetched and rendered (ADR-011 model cards).
  await expect(page.getByText('openWakeWord melspectrogram')).toBeVisible()
  // KWS backend availability section.
  await expect(page.getByText('OpenWakeWord (mel -> embedding -> classifier)')).toBeVisible()
})

test('live workspace panels still render (AFE/KWS/Few-Shot/Training)', async ({ page }) => {
  await page.goto('/#/workspace')

  // AFE live pipeline.
  await expect(page.getByText('Live AFE pipeline')).toBeVisible()
  // KWS detection.
  await expect(page.getByText('KWS detection')).toBeVisible()
  // Few-Shot enrollment (h2 in the panel).
  await expect(page.getByRole('main').getByRole('heading', { name: 'Few-Shot enrollment' })).toBeVisible()

  // Training is under the "Modules" tab.
  await page.getByRole('tab', { name: 'Modules' }).click()
  await expect(
    page.getByRole('heading', { name: /Traditional KWS — Training/i }),
  ).toBeVisible()
})

test('KWS panel renders with the pluggable-backend UI (ADR-020)', async ({ page }) => {
  await page.goto('/#/workspace')

  await expect(page.getByText(/pluggable KWS backend/i)).toBeVisible()

  const loadButton = page.getByRole('button', { name: /Load KWS models/i })
  await expect(loadButton).toBeVisible()

  // Clicking load transitions away from idle. Actual model loading is too
  // slow for e2e and is validated manually.
  await loadButton.click()
  await expect(loadButton).toBeHidden({ timeout: 5_000 })
})

test('Few-Shot enrollment panel renders (Phase 3)', async ({ page }) => {
  await page.goto('/#/workspace')

  await expect(page.getByRole('heading', { name: /Few-Shot enrollment/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /Load PLiX encoder/i })).toBeVisible()
})

test('Traditional KWS Training panel renders (§4.2)', async ({ page }) => {
  await page.goto('/#/workspace')

  await page.getByRole('tab', { name: 'Modules' }).click()
  await expect(
    page.getByRole('heading', { name: /Traditional KWS — Training/i }),
  ).toBeVisible()
  await expect(page.getByText(/Network architecture/i)).toBeVisible()
  await expect(page.getByText(/Target keyword list/i)).toBeVisible()

  await expect(page.getByText(/Audio augmentation/i)).toBeHidden()
  await page.getByRole('button', { name: /Advanced/i }).first().click()
  await expect(page.getByText(/Audio augmentation/i)).toBeVisible()
})

/** Click a primary/secondary nav item in the left sidebar. */
async function sidebarNav(
  page: import('@playwright/test').Page,
  name: string,
): Promise<void> {
  await page.locator('aside').getByRole('button', { name }).click()
}
