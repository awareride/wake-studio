import { test, expect } from '@playwright/test'

/**
 * Recent projects menu in the workspace (epic #53 P6, plan §7).
 *
 * The Recent menu is the project switcher: it shows the current project name
 * and lists up to 5 recent projects (MRU) with an "updated …" caption.
 * "+ New project…" opens the same dialog as the ProjectBar. The menu lives
 * in the workspace content (hidden on other views).
 */

test('recent projects: create via menu, switch from another view', async ({ page }) => {
  await page.goto('/#/workspace')

  // The trigger shows "No project selected" when nothing is active; create a
  // project through its "+ New project…" entry (shared dialog).
  await page.getByRole('button', { name: /No project selected/ }).click()
  await page.getByRole('menuitem', { name: /New project/ }).click()
  await page.getByRole('textbox', { name: 'Project name' }).fill('Recent Word')
  await page.getByRole('textbox', { name: 'Wake word' }).fill('hey recent')
  await page.getByRole('button', { name: 'Create' }).click()

  // The trigger now shows the current project name.
  await expect(page.getByRole('button', { name: /Recent Word/ })).toBeVisible()

  // Navigate away to the model registry — the workspace (and its menu) is
  // kept alive but hidden.
  await page.locator('aside').getByRole('button', { name: 'Model Registry' }).click()
  await expect(page).toHaveURL(/#\/library/)
  await expect(page.getByRole('button', { name: /Recent Word/ })).toBeHidden()

  // Back on the workspace, the menu lists the project with "updated …".
  await page.locator('aside').getByRole('button', { name: 'Workspace' }).click()
  await page.getByRole('button', { name: /Recent Word/ }).click()
  const item = page.getByRole('menuitem', { name: /Recent Word/ })
  await expect(item).toBeVisible()
  await expect(item).toContainText(/updated/)

  // Selecting it keeps the project active on the workspace.
  await item.click()
  await expect(page).toHaveURL(/#\/workspace/)
  await expect(page.getByRole('button', { name: /Recent Word/ })).toBeVisible()
})
