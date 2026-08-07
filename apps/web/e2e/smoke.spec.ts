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
  await expect(page.getByRole('heading', { name: /Models \(\d+ of \d+\)/ })).toBeVisible()

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

test('live workspace panels still render (AFE/KWS)', async ({ page }) => {
  await page.goto('/#/workspace')

  // AFE live pipeline.
  await expect(page.getByText('Live AFE pipeline')).toBeVisible()
  // KWS detection.
  await expect(page.getByText('KWS detection')).toBeVisible()
  // KWS config is visible up front (spec-driven, ADR-017) - not gated behind
  // a successful model load (the former "Modules" tab and the Training
  // placeholder were removed). The KWS stage has its own "Configuration
  // (backend · Primary)" heading (ADR-025 driver spec panel).
  await expect(
    page.getByRole('heading', { name: /Configuration \(backend/ }),
  ).toBeVisible()
})

test('KWS panel renders with the pluggable-backend UI (ADR-020)', async ({ page }) => {
  await page.goto('/#/workspace')

  await expect(page.getByText(/pluggable KWS backend/i)).toBeVisible()

  // Model sources editor renders the per-role model selector (built-in
  // registry entries + custom URL option) - the user can pick which
  // pretrained model each role uses, or supply their own artifact URL.
  await expect(page.getByText('Model sources')).toBeVisible()
  const melSelect = page
    .getByRole('combobox', { name: /Mel front-end/ })
  await expect(melSelect).toBeVisible()

  const loadButton = page.getByRole('button', { name: /Load models/i })
  await expect(loadButton).toBeVisible()

  // Clicking load transitions away from idle. Actual model loading is too
  // slow for e2e and is validated manually.
  await loadButton.click()
  await expect(loadButton).toBeHidden({ timeout: 5_000 })
})

test('Few-Shot enrollment lives in the KWS panel plixkws branch (Phase 3)', async ({ page }) => {
  await page.goto('/#/workspace')

  // Select the plixkws backend; the KWS panel shows the enrollment controls
  // (encoder variant + runtime + Load PLiX encoder) instead of a dead button.
  await page.getByLabel('Backend').selectOption('plixkws')
  await expect(page.getByText(/PLiX Few-Shot enrollment/)).toBeVisible()
  await expect(page.getByRole('button', { name: /Load PLiX encoder/i })).toBeVisible()
  // The generic KWS config panel is hidden for plixkws (enrollment replaces it).
  await expect(page.getByText('Tunable parameters')).toBeHidden()
})

test('Traditional KWS Training panel is not shown (no-op placeholder)', async ({ page }) => {
  // Training is a no-op stub until real backend wiring lands (Phase 5); it
  // must not surface in the Workspace. The module keeps its spec-driven panel
  // for the future - see packages/modules/training.
  await page.goto('/#/workspace')
  await expect(
    page.getByRole('heading', { name: 'Training (custom wake-word)' }),
  ).toBeHidden()
})

test('workspace: create a project and it persists across reload', async ({ page }) => {
  await page.goto('/#/workspace')

  // Project bar dropdown -> New project. The trigger shows the current
  // project name or "No project selected".
  await page.getByRole('button', { name: /No project selected|▾/ }).first().click()
  await page.getByRole('menuitem', { name: /New project/ }).click()

  await page.getByRole('textbox', { name: 'Project name' }).fill('E2E Word')
  await page.getByRole('textbox', { name: 'Wake word' }).fill('hey e2e')
  await page.getByRole('button', { name: 'Create' }).click()

  // Project bar shows the new project; pipeline canvas is present.
  await expect(page.getByText('E2E Word').first()).toBeVisible()
  await expect(page.getByText('AEC → BSS → NS → KWS')).toBeVisible()

  // Reload: the project (and selection) persists via IndexedDB + localStorage.
  // refresh() is async (IndexedDB), so wait for the project bar to settle.
  await page.reload()
  await page.waitForSelector('aside')
  await expect(page.getByText('E2E Word').first()).toBeVisible({ timeout: 10_000 })
})

/** Click a primary/secondary nav item in the left sidebar. */
async function sidebarNav(
  page: import('@playwright/test').Page,
  name: string,
): Promise<void> {
  await page.locator('aside').getByRole('button', { name }).click()
}
