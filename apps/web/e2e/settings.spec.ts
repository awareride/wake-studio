import { test, expect } from '@playwright/test'

/**
 * Settings view e2e (issue #52).
 *
 * Covers: real Settings view renders (not a placeholder), theme switch flips
 * documentElement.dataset.theme, secret fields render as password inputs,
 * driver module settings persist to localStorage, export masks secrets,
 * reset restores defaults.
 */

test('settings view renders platform + module groups', async ({ page }) => {
  await page.goto('/#/settings')

  // Real view heading + left rail.
  await expect(page.getByRole('main').getByRole('heading', { name: 'Settings' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'General' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Security' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Data' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Modules' })).toBeVisible()

  // General group shows theme + locale controls.
  await expect(page.getByText('Theme', { exact: true })).toBeVisible()
  await expect(page.getByText('Language', { exact: true })).toBeVisible()
})

test('theme switch flips the document theme', async ({ page }) => {
  await page.goto('/#/settings')

  // The theme control is a Radix select trigger, rendered as a textbox whose
  // accessible name is the current value ("light"). Click it, then pick Dark
  // from the portal listbox.
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
  await page.goto('/#/settings')

  // Security rail.
  await page.getByRole('button', { name: 'Security' }).click()
  const apiKeyInput = page.locator('input[type="password"]')
  await expect(apiKeyInput.first()).toBeVisible()
})

test('module settings persist driver params to localStorage', async ({ page }) => {
  await page.goto('/#/settings')

  await page.getByRole('button', { name: 'Modules' }).click()

  // Drivers with a spec appear (openwakeword/sherpa/plix). The sherpa
  // keywords param is a string control (module-kit text input).
  await expect(page.getByText('Wake words (comma-separated)')).toBeVisible()

  // The sherpa keywords string control: a textbox whose placeholder is the
  // default keyword list (Chinese chars). Target by placeholder.
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
  await page.goto('/#/settings')

  // Seed a secret so export has something to mask.
  await page.getByRole('button', { name: 'Security' }).click()
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
