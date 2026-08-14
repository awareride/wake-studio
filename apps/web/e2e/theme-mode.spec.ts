import { test, expect, type Page } from '@playwright/test'

/**
 * Theme mode (issue #142): top-bar switch for Light / Dark / System.
 *
 * - Light and Dark apply the matching token layer (data-theme + color-scheme).
 * - System follows the OS preference, live.
 * - The choice persists across reloads.
 */

async function openThemeMenu(page: Page) {
  await page.getByRole('button', { name: /Theme:/ }).click()
}

test('top-bar switch applies Light and Dark and persists', async ({ page }) => {
  await page.goto('/')
  // Default is Light.
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')

  // Switch to Dark.
  await openThemeMenu(page)
  await page.getByRole('menuitem', { name: 'Dark' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

  const dark = await page.evaluate(() => ({
    colorScheme: getComputedStyle(document.documentElement).colorScheme,
    bodyBg: getComputedStyle(document.body).backgroundColor,
    surface: getComputedStyle(document.documentElement).getPropertyValue('--ws-surface'),
  }))
  expect(dark.colorScheme).toBe('dark')
  // Dark surface resolves to a real (dark) color, not transparent.
  expect(dark.surface.trim()).toBe('17 17 19')
  expect(dark.bodyBg).not.toBe('rgba(0, 0, 0, 0)')

  // Switch back to Light.
  await openThemeMenu(page)
  await page.getByRole('menuitem', { name: 'Light' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')

  // Dark persists across a reload.
  await openThemeMenu(page)
  await page.getByRole('menuitem', { name: 'Dark' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
})

test('System follows the OS color scheme, live', async ({ page }) => {
  await page.goto('/')

  // Emulate the OS via CDP: unlike page.emulateMedia, this fires the
  // matchMedia change event the app listens to.
  const session = await page.context().newCDPSession(page)
  const setOs = (colorScheme: 'light' | 'dark') =>
    session.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value: colorScheme }],
    })

  await setOs('dark')
  await openThemeMenu(page)
  await page.getByRole('menuitem', { name: 'System' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

  // OS preference change is picked up without a reload.
  await setOs('light')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
})
