import { expect, type Page } from '@playwright/test'

/**
 * Enable the KWS stage (epic #53 UX).
 *
 * KWS enable/disable lives on the KWS stage card (a toggle pill); the KWS
 * config panel is reached by selecting the card. KWS specs must enable the
 * stage and open the card first.
 */
export async function enableKws(page: Page): Promise<void> {
  const toggle = page.getByRole('button', { name: 'KWS toggle' })
  if ((await toggle.getAttribute('aria-pressed')) !== 'true') {
    await toggle.click()
  }
  await page.getByRole('button', { name: 'KWS config' }).click()
  await expect(page.getByText('KWS detection')).toBeVisible()
}
