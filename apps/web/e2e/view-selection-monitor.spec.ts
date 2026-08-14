import { test, expect, type Page } from '@playwright/test'

/**
 * View selection independence/remembering (issues #138, #139) and the source
 * panel Monitor switch (issue #140).
 *
 * - Projects selection is independent of the Workspace's current project and
 *   is remembered across view switches.
 * - Trains keeps its selected train when switching views.
 * - The mic source panel's Monitor toggle shows a feedback warning when on.
 */

async function createProject(page: Page, name: string, word: string) {
  // The trigger shows the current project name (or "No project selected").
  await page.getByRole('button', { name: /No project selected|Alpha/ }).first().click()
  await page.getByRole('menuitem', { name: /New project/ }).click()
  await page.getByRole('textbox', { name: 'Project name' }).fill(name)
  await page.getByRole('textbox', { name: 'Wake word' }).fill(word)
  await page.getByRole('button', { name: 'Create' }).click()
}

test('Projects selection is independent of the Workspace project and remembered', async ({
  page,
}) => {
  await page.goto('/#/workspace')
  await createProject(page, 'Alpha', 'hey alpha')
  await createProject(page, 'Beta', 'hey beta')

  // The Workspace's active project is Beta (last created).
  await expect(page.getByRole('button', { name: 'Beta' })).toBeVisible()

  // Projects view: select Alpha — it must not change the Workspace project.
  await page.goto('/#/projects')
  await page.getByRole('button', { name: /Alpha/ }).click()
  await expect(page.getByRole('heading', { name: 'Alpha' })).toBeVisible()

  // Workspace project unchanged (still Beta).
  await page.goto('/#/workspace')
  await expect(page.getByRole('button', { name: 'Beta' })).toBeVisible()

  // Projects selection is remembered when switching back.
  await page.goto('/#/projects')
  await expect(page.getByRole('heading', { name: 'Alpha' })).toBeVisible()
})

test('selected train is remembered when switching views', async ({ page }) => {
  await page.goto('/#/training')

  // Create a train (Colab) so the details pane has content.
  await page.getByRole('button', { name: 'New' }).click()
  await page.getByRole('button', { name: /OpenWakeWord/ }).click()
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await page.getByRole('button', { name: /Google Colab/ }).click()
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('Inputs review')).toBeVisible()

  // Switch away and back: the same train is still selected.
  await page.goto('/#/workspace')
  await page.goto('/#/training')
  await expect(page.getByText('Inputs review')).toBeVisible()
})

test('source panel Monitor switch shows a feedback warning', async ({ page }) => {
  await page.goto('/#/workspace')

  const monitor = page.getByRole('checkbox', { name: /Monitor/ })
  await expect(monitor).toBeVisible()
  await expect(page.getByText(/Monitor is on/)).toBeHidden()

  await monitor.check()
  await expect(page.getByText(/Monitor is on/)).toBeVisible()

  await monitor.uncheck()
  await expect(page.getByText(/Monitor is on/)).toBeHidden()
})
