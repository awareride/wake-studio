import { test, expect } from '@playwright/test'

/**
 * Settings view e2e (issue #52, save-to-apply).
 *
 * The settings section menu lives in the shell sidebar (Settings sub-menu);
 * the view renders section content full-width at #/settings/<section>.
 * Edits go into a local draft; Save persists them. Covers: sub-route
 * rendering, focus on the clicked sub-item (parent not highlighted),
 * save-to-apply theme, secret password inputs, module settings save.
 */

test('settings sub-routes render section content', async ({ page }) => {
  // General is the default settings landing.
  await page.goto('/#/settings/general')
  await expect(
    page.getByRole('main').getByRole('heading', { name: 'General', exact: true }),
  ).toBeVisible()
  await expect(page.getByText('Theme', { exact: true })).toBeVisible()
  await expect(page.getByText('Language', { exact: true })).toBeVisible()

  // Sidebar sub-menu shows sections + drivers directly under Settings.
  await expect(
    page.locator('aside').getByRole('button', { name: 'General' }),
  ).toBeVisible()
  await expect(
    page.locator('aside').getByRole('button', { name: 'Security' }),
  ).toBeVisible()
  // Drivers appear as Settings children (no intermediate Modules layer).
  await expect(
    page
      .locator('aside')
      .getByRole('button', { name: /sherpa-onnx KWS/ })
      .first(),
  ).toBeVisible()

  // Click a driver: lands on the modules section with the driver focused.
  await page
    .locator('aside')
    .getByRole('button', { name: /sherpa-onnx KWS/ })
    .first()
    .click()
  await expect(page).toHaveURL(/#\/settings\/modules\/sherpa-onnx-kws/)
  await expect(
    page.getByRole('heading', { name: 'Module settings' }),
  ).toBeVisible()
})

test('clicking a sub-item highlights only that item, not the Settings parent', async ({
  page,
}) => {
  await page.goto('/#/settings/security')

  // The Security sub-item is highlighted...
  await expect(
    page.locator('aside').getByRole('button', { name: 'Security' }),
  ).toHaveAttribute('aria-current', 'page')
  // ...but the Settings parent is not.
  await expect(
    page
      .locator('aside')
      .getByRole('button', { name: /Settings menu/ }),
  ).not.toHaveAttribute('aria-current', 'page')
})

test('theme changes apply only after Save', async ({ page }) => {
  await page.goto('/#/settings/general')

  // The theme control is the first Radix select trigger (role "combobox";
  // three exist: theme/locale/execution-provider). The first is Theme.
  const themeTrigger = page.getByRole('combobox').first()
  await themeTrigger.click()
  const darkOption = page.getByRole('option', { name: 'Dark' })
  await darkOption.waitFor({ state: 'visible', timeout: 5000 })
  await darkOption.click()

  // Not saved yet: theme unchanged, nothing persisted.
  let theme = await page.evaluate(() => document.documentElement.dataset.theme)
  expect(theme).toBe('light')
  let stored = await page.evaluate(() =>
    localStorage.getItem('wake-studio:settings:platform'),
  )
  expect(stored ?? '').not.toContain('"theme":"dark"')

  // Save applies it.
  await page.getByRole('button', { name: 'Save' }).click()
  theme = await page.evaluate(() => document.documentElement.dataset.theme)
  expect(theme).toBe('dark')
  stored = await page.evaluate(() =>
    localStorage.getItem('wake-studio:settings:platform'),
  )
  expect(stored).toContain('"theme":"dark"')
})

test('secret fields render as password inputs', async ({ page }) => {
  await page.goto('/#/settings/security')

  const apiKeyInput = page.locator('input[type="password"]')
  await expect(apiKeyInput.first()).toBeVisible()
})

test('module settings persist only after Save', async ({ page }) => {
  await page.goto('/#/settings/modules')

  // The sherpa keywords string control: a textbox whose placeholder is the
  // default keyword list (Chinese chars). Target by placeholder.
  await expect(page.getByText('Wake words (comma-separated)')).toBeVisible()
  const editable = page.getByPlaceholder(/你好/).first()
  await editable.fill('test keyword @wake')
  await page.waitForTimeout(100)

  // Not saved yet.
  let stored = await page.evaluate(() =>
    localStorage.getItem('wake-studio:settings:module'),
  )
  expect(stored || '').not.toContain('test keyword @wake')

  // Save persists everything (the single bottom Save bar).
  await page.getByRole('button', { name: 'Save' }).last().click()
  await page.waitForTimeout(150)
  stored = await page.evaluate(() =>
    localStorage.getItem('wake-studio:settings:module'),
  )
  expect(stored).toContain('sherpa-onnx-kws')
  expect(stored).toContain('test keyword @wake')
})

test('mobile drawer positions correctly and expands Settings sub-menu', async ({
  page,
}) => {
  // Narrow viewport: the sidebar collapses into the mobile drawer.
  await page.setViewportSize({ width: 500, height: 700 })
  await page.goto('/#/workspace')

  await page.getByRole('button', { name: 'Toggle navigation' }).click()
  const drawer = page.locator('[role="dialog"]')
  await expect(drawer).toBeVisible()

  // Drawer sits at the left edge, full height (GitHub-style side panel, not a
  // centered dialog). Wait for the slide-in animation to settle before
  // measuring.
  await page.waitForTimeout(400)
  const geo = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]')
    if (!d) return null
    const r = d.getBoundingClientRect()
    return {
      x: r.x,
      y: r.y,
      w: r.width,
      h: r.height,
      vh: window.innerHeight,
      vw: window.innerWidth,
    }
  })
  expect(geo).toMatchObject({
    x: 0,
    y: 0,
    w: expect.any(Number),
    h: expect.any(Number),
  })
  expect(geo!.h).toBe(geo!.vh)

  // Settings expands inside the drawer and the sub-items render.
  await drawer.getByRole('button', { name: /Settings menu/ }).click()
  await expect(
    drawer.getByRole('button', { name: 'General' }),
  ).toBeVisible()
})
