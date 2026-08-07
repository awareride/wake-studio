import { expect, type Page } from '@playwright/test'

/**
 * Enable the KWS component in the workspace pipeline canvas (epic #53 P7).
 *
 * The workspace config is a pipeline-shaped tab flow (Source → … → KWS);
 * the KWS tab only exists when the KWS component toggle is on, and the KWS
 * panel renders inside that tab. KWS specs must enable the toggle and select
 * the tab first.
 */
export async function enableKws(page: Page): Promise<void> {
  const toggle = page.getByRole('checkbox', { name: 'KWS', exact: true })
  if (!(await toggle.isChecked())) {
    await toggle.check()
  }
  await page.getByRole('button', { name: 'KWS config' }).click()
  await expect(page.getByText('KWS detection')).toBeVisible()
}
