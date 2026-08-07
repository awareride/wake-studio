import { expect, type Page } from '@playwright/test'

/**
 * Enable the KWS component in the workspace pipeline canvas (epic #53 P7).
 *
 * Since P7 the KWS configuration step (Step C) only renders when the KWS
 * component toggle is on (plan §8.1). KWS specs that used to rely on the
 * always-visible KWS panel must enable it first.
 */
export async function enableKws(page: Page): Promise<void> {
  const toggle = page.getByRole('checkbox', { name: 'KWS', exact: true })
  if (!(await toggle.isChecked())) {
    await toggle.check()
  }
  await expect(page.getByText('KWS detection')).toBeVisible()
}
