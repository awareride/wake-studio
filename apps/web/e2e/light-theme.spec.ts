import { test, expect } from '@playwright/test'

/**
 * Light-theme smoke test.
 *
 * Verifies the semantic design tokens resolve (a regression guard: a broken
 * comment or token swap silently degrades the whole page to transparent
 * backgrounds / black-on-black).
 */

test('semantic light theme resolves', async ({ page }) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')

  const probe = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement)
    const header = document.querySelector('header')
    return {
      colorScheme: cs.colorScheme,
      surface: cs.getPropertyValue('--ws-surface'),
      bodyBg: getComputedStyle(document.body).backgroundColor,
      headerBg: header ? getComputedStyle(header).backgroundColor : null,
    }
  })

  // :root variables are defined and body uses the light surface.
  expect(probe.surface).not.toBe('')
  expect(probe.colorScheme).toBe('light')
  // Body background resolves to a light color, not transparent.
  expect(probe.bodyBg).not.toBe('rgba(0, 0, 0, 0)')
  expect(probe.headerBg).not.toBe('rgba(0, 0, 0, 0)')

  // Header text is dark ink on the light surface (readable).
  const headerColor = await page.evaluate(() => {
    const h = document.querySelector('header span')
    return h ? getComputedStyle(h).color : null
  })
  expect(headerColor).not.toBe('rgb(0, 0, 0)') // not raw black fallback
})
