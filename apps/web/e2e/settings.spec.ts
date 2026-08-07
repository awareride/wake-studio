import { test, expect } from '@playwright/test'

/**
 * Settings view e2e (issue #52, sub-route restructure).
 *
 * The settings section menu lives in the shell sidebar (Settings sub-menu);
 * the view renders section content full-width at #/settings/<section>.
 * Covers: sub-route rendering, theme flip, secret password inputs, module
 * settings persistence, export-mask/reset.
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

test('theme switch flips the document theme', async ({ page }) => {
  await page.goto('/#/settings/general')

  // The theme control is the first Radix select trigger (role "combobox";
  // three exist: theme/locale/execution-provider). The first is Theme.
  const themeTrigger = page.getByRole('combobox').first()
  await themeTrigger.click()
  // Radix Select renders options in a portal listbox; pick Dark.
  const darkOption = page.getByRole('option', { name: 'Dark' })
  await darkOption.waitFor({ state: 'visible', timeout: 5000 })
  await darkOption.click()

  // documentElement.dataset.theme flips immediately (context side-effect).
  const theme = await page.evaluate(() => document.documentElement.dataset.theme)
  expect(theme).toBe('dark')

  // Persisted to localStorage.
  const stored = await page.evaluate(() =>
    localStorage.getItem('wake-studio:settings:platform'),
  )
  expect(stored).toContain('"theme":"dark"')
})

test('secret fields render as password inputs', async ({ page }) => {
  await page.goto('/#/settings/security')

  const apiKeyInput = page.locator('input[type="password"]')
  await expect(apiKeyInput.first()).toBeVisible()
})

test('module settings persist driver params to localStorage', async ({ page }) => {
  await page.goto('/#/settings/modules')

  // The sherpa keywords string control: a textbox whose placeholder is the
  // default keyword list (Chinese chars). Target by placeholder.
  await expect(page.getByText('Wake words (comma-separated)')).toBeVisible()
  const editable = page.getByPlaceholder(/你好/).first()
  await editable.fill('test keyword @wake')
  await page.waitForTimeout(150)

  const stored = await page.evaluate(() =>
    localStorage.getItem('wake-studio:settings:module'),
  )
  expect(stored).toContain('sherpa-onnx-kws')
  expect(stored).toContain('test keyword @wake')
})

test('export masks secrets and reset restores defaults', async ({ page }) => {
  await page.goto('/#/settings/security')

  // Seed a secret so export has something to mask.
  const apiKeyInput = page.locator('input[type="password"]').first()
  await apiKeyInput.fill('sk-super-secret')

  // Export triggers a download; intercept it to inspect the payload.
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: /Export settings/ }).click()
  const download = await downloadPromise
  const path = await download.path()
  const fs = await import('node:fs')
  const json = JSON.parse(fs.readFileSync(path!, 'utf8'))
  // Secrets masked; theme untouched.
  expect(json.platform['backend.apiKey']).toBe('••••••••')
  expect(json.platform.theme).toBeDefined()

  // Reset restores defaults (secret cleared).
  await page.getByRole('button', { name: /Reset to defaults/ }).click()
  await page.waitForTimeout(100)
  const stored = await page.evaluate(() =>
    localStorage.getItem('wake-studio:settings:platform'),
  )
  expect(stored).toBeNull()
})
