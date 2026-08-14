import { test, expect } from '@playwright/test'

/**
 * New-train wizard browser-history navigation (issue #136).
 *
 * Wizard steps are hash-encoded (`#/training/new[/<step>]`), so each step is
 * its own history entry: browser back/forward walk the steps instead of
 * leaving the Training view. Leaving the wizard with unsaved progress still
 * asks first.
 */

test('browser back walks the New-train wizard steps, then leaves cleanly', async ({ page }) => {
  await page.goto('/#/training')

  await page.getByRole('button', { name: 'New' }).click()

  // Step 1 — choose a model type.
  await expect(page.getByText('Pick the module you want to train.')).toBeVisible()
  await page.getByRole('button', { name: /OpenWakeWord/ }).click()
  await page.getByRole('button', { name: 'Next', exact: true }).click()

  // Step 2 — configure.
  await expect(page.getByText('Set the training params for the chosen module.')).toBeVisible()
  await page.getByRole('button', { name: 'Next', exact: true }).click()

  // Step 3 — choose a train method.
  await expect(
    page.getByText('Pick where training runs, from the methods the module supports.'),
  ).toBeVisible()
  await page.getByRole('button', { name: /Google Colab/ }).click()
  await page.getByRole('button', { name: 'Next', exact: true }).click()

  // Step 4 — ready to start.
  await expect(page.getByText('Review the train, then start it.')).toBeVisible()

  // Browser back walks the steps in reverse (the bug: it used to jump
  // straight out of the Training view).
  await page.goBack()
  await expect(
    page.getByText('Pick where training runs, from the methods the module supports.'),
  ).toBeVisible()
  await page.goBack()
  await expect(page.getByText('Set the training params for the chosen module.')).toBeVisible()
  await page.goBack()
  await expect(page.getByText('Pick the module you want to train.')).toBeVisible()

  // Selections survive the walk (same wizard instance, only the step moved).
  await expect(page.getByRole('button', { name: /OpenWakeWord/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  // One more back leaves the wizard — unsaved progress asks first.
  await page.goBack()
  await expect(page.getByText('Leave without saving this train?')).toBeVisible()
  await page.getByRole('button', { name: 'Leave anyway' }).click()

  // Back on the Trains list.
  await expect(page.getByRole('button', { name: 'New' })).toBeVisible()
  await expect(page).toHaveURL(/#\/training$/)
})

test('browser forward re-enters the step it was on', async ({ page }) => {
  await page.goto('/#/training')

  await page.getByRole('button', { name: 'New' }).click()
  await page.getByRole('button', { name: /OpenWakeWord/ }).click()
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(page.getByText('Set the training params for the chosen module.')).toBeVisible()

  // Back one step, then forward again: the wizard follows both directions.
  await page.goBack()
  await expect(page.getByText('Pick the module you want to train.')).toBeVisible()
  await page.goForward()
  await expect(page.getByText('Set the training params for the chosen module.')).toBeVisible()
})

test('wizard notebook review: browser back returns to the Ready step', async ({ page }) => {
  await page.goto('/#/training')

  await page.getByRole('button', { name: 'New' }).click()
  await page.getByRole('button', { name: /OpenWakeWord/ }).click()
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await page.getByRole('button', { name: /Google Colab/ }).click()
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(page.getByText('Review the train, then start it.')).toBeVisible()

  // Open the notebook review — it is its own history entry.
  await page.getByRole('button', { name: 'Review', exact: true }).click()
  await expect(page.getByText('Notebook review — train.ipynb')).toBeVisible()
  await expect(page).toHaveURL(/#\/training\/new\/ready\/review$/)

  // Browser back closes the review and returns to the Ready step.
  await page.goBack()
  await expect(page.getByText('Notebook review — train.ipynb')).toBeHidden()
  await expect(page.getByText('Review the train, then start it.')).toBeVisible()
})

test('train details notebook review: browser back returns to the details pane', async ({ page }) => {
  await page.goto('/#/training')

  // Create a train (Colab) so the details pane has a notebook to review.
  await page.getByRole('button', { name: 'New' }).click()
  await page.getByRole('button', { name: /OpenWakeWord/ }).click()
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await page.getByRole('button', { name: /Google Colab/ }).click()
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await page.getByRole('button', { name: 'Save', exact: true }).click()

  // The details pane's Inputs review opens the full notebook review.
  await page.getByRole('button', { name: 'Review', exact: true }).click()
  await expect(page.getByText('Notebook review — train.ipynb')).toBeVisible()

  // Browser back returns to the train details.
  await page.goBack()
  await expect(page.getByText('Notebook review — train.ipynb')).toBeHidden()
  await expect(page.getByText('Inputs review')).toBeVisible()
})

test('Backends: New editor and Colab guide/preview are back-closeable', async ({ page }) => {
  await page.goto('/#/backends')

  // New → full-panel editor; browser back returns to the list.
  await page.getByRole('button', { name: 'New', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'New backend' })).toBeVisible()
  await page.goBack()
  await expect(page.getByRole('heading', { name: 'New backend' })).toBeHidden()
  await expect(page.getByRole('heading', { name: 'Backends', level: 2 })).toBeVisible()

  // Free On Google Colab → guide; Review → preview; back walks both.
  await page.getByRole('button', { name: /Free On Google Colab/ }).click()
  await expect(page.getByRole('heading', { name: 'Free on Google Colab' })).toBeVisible()
  await page.getByRole('button', { name: 'Review', exact: true }).click()
  await expect(page.getByText('Notebook review — studio-backend.ipynb')).toBeVisible()
  await page.goBack()
  await expect(page.getByText('Notebook review — studio-backend.ipynb')).toBeHidden()
  await expect(page.getByRole('heading', { name: 'Free on Google Colab' })).toBeVisible()
  await page.goBack()
  await expect(page.getByRole('heading', { name: 'Backends', level: 2 })).toBeVisible()
})
