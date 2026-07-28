import { test, expect } from '@playwright/test'

test('app shell renders the pipeline', async ({ page }) => {
  await page.goto('/')

  await expect(page).toHaveTitle('WakeStudio')
  await expect(page.getByRole('heading', { name: /From wake-word idea/i })).toBeVisible()

  // The four pipeline stages are rendered (ADR-001).
  await expect(page.getByText('Acoustic Echo Cancellation')).toBeVisible()
  await expect(page.getByText('Blind Source Separation')).toBeVisible()
  await expect(page.getByText('Noise Suppression')).toBeVisible()
  await expect(page.getByText('Keyword Spotting')).toBeVisible()
})

test('KWS panel renders with the pluggable-backend UI (ADR-020)', async ({ page }) => {
  await page.goto('/')

  // The KWS section heading and description are visible.
  await expect(page.getByRole('heading', { name: /KWS detection/i })).toBeVisible()
  await expect(page.getByText(/pluggable KWS backend/i)).toBeVisible()

  // The "Load KWS models" button is visible in the idle state.
  const loadButton = page.getByRole('button', { name: /Load KWS models/i })
  await expect(loadButton).toBeVisible()

  // Clicking load transitions away from idle (button disappears). Actual model
  // loading (ONNX/WASM init + remote fetch) is too slow for e2e and is validated
  // manually; here we only assert the UI transitions out of idle.
  await loadButton.click()
  await expect(loadButton).toBeHidden({ timeout: 5_000 })
})

test('Few-Shot enrollment panel renders (Phase 3)', async ({ page }) => {
  await page.goto('/')

  // The Few-Shot section heading is visible.
  await expect(page.getByRole('heading', { name: /Few-Shot enrollment/i })).toBeVisible()

  // The "Load PLiX encoder" button is visible in the idle state.
  await expect(page.getByRole('button', { name: /Load PLiX encoder/i })).toBeVisible()
})

test('ASR-Decoding KWS panel renders (Phase 2-ext, ADR-024)', async ({ page }) => {
  await page.goto('/')

  // The ASR-Decoding section heading + description are visible.
  await expect(
    page.getByRole('heading', { name: /ASR-Decoding KWS/i }),
  ).toBeVisible()
  await expect(page.getByText(/Inference only \(P0, ADR-024\)/i)).toBeVisible()

  // The editable wake-word list + "Load ASR engine" button are visible.
  await expect(page.getByText(/Wake-word list/i)).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Load ASR engine' }),
  ).toBeVisible()

  // The wake-word list becomes editable after the engine loads (asset-
  // dependent); at idle the Load button + list heading are the stable UI.
  await expect(
    page.getByRole('button', { name: /\+ Add/i }),
  ).toBeHidden()
})

test('Traditional KWS Training panel renders (§4.2)', async ({ page }) => {
  await page.goto('/')

  await expect(
    page.getByRole('heading', { name: /Traditional KWS — Training/i }),
  ).toBeVisible()
  // Primary params visible.
  await expect(page.getByText(/Network architecture/i)).toBeVisible()
  await expect(page.getByText(/Target keyword list/i)).toBeVisible()
  // Advanced is collapsible.
  await expect(page.getByText(/Audio augmentation/i)).toBeHidden()
  await page.getByRole('button', { name: /Advanced/i }).first().click()
  await expect(page.getByText(/Audio augmentation/i)).toBeVisible()
})
