import { test, expect } from '@playwright/test'

/**
 * TopBar recent projects (epic #53 P6, plan §7).
 *
 * The shell TopBar lists up to 5 recent projects (MRU) with an "updated …"
 * caption; selecting one switches the active project and navigates back to
 * the workspace. The "+ New project…" entry opens the same dialog as the
 * ProjectBar (shared component).
 */

test('top bar recent projects: create via menu, switch from another view', async ({ page }) => {
  await page.goto('/#/workspace')

  // Create a project through the TopBar "+ New project…" entry — this also
  // covers the shared-dialog path (same form as ProjectBar).
  await page.getByRole('button', { name: 'Recent projects' }).click()
  await page.getByRole('menuitem', { name: /New project/ }).click()
  await page.getByRole('textbox', { name: 'Project name' }).fill('Recent Word')
  await page.getByRole('textbox', { name: 'Wake word' }).fill('hey recent')
  await page.getByRole('button', { name: 'Create' }).click()

  // The project is selected in the workspace (ProjectBar shows it).
  await expect(page.getByText('Recent Word').first()).toBeVisible()

  // Navigate away to the model library.
  await page.locator('aside').getByRole('button', { name: 'Model Library' }).click()
  await expect(page).toHaveURL(/#\/library/)

  // The recent-projects menu lists the project with its "updated …" caption.
  await page.getByRole('button', { name: 'Recent projects' }).click()
  const item = page.getByRole('menuitem', { name: /Recent Word/ })
  await expect(item).toBeVisible()
  await expect(item).toContainText(/updated/)

  // Selecting it navigates back to the workspace with the project active.
  await item.click()
  await expect(page).toHaveURL(/#\/workspace/)
  await expect(page.getByText('Recent Word').first()).toBeVisible()
})
