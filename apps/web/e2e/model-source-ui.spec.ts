import { test, expect } from '@playwright/test'

/**
 * Model-source editor - L3 browser test (issue: model selection).
 *
 * The KWS panel's "Model sources" block lets the user pick which pretrained
 * model each role uses (built-in registry entries) or supply a custom URL
 * (e.g. a model trained with this platform). This spec pins the UI contract:
 * the editor renders per-role selectors, the registry candidates appear, and
 * choosing "Custom URL…" reveals a URL input whose value is used on Load.
 */

test('Model source editor renders registry candidates and custom URL input', async ({
  page,
}) => {
  await page.goto('/#/workspace')

  // The block and the per-role selector render.
  await expect(page.getByText('Model sources')).toBeVisible()
  const melSelect = page.getByRole('combobox', { name: /Mel front-end/ })
  await expect(melSelect).toBeVisible()

  // The built-in registry candidates are available (registry is local JSON).
  await expect(melSelect.locator('option[value="melspectrogram"]')).toHaveCount(1)
  const classifierSelect = page.getByRole('combobox', {
    name: /Wake-word classifier/,
  })
  await expect(classifierSelect).toBeVisible()
  // hey-buddy is the default classifier; the openwakeword demo classifiers
  // are also candidates if they were registered.
  await expect(classifierSelect.locator('option[value="hey-buddy"]')).toHaveCount(1)

  // Choosing "Custom URL…" reveals the URL input.
  await melSelect.selectOption('custom')
  const urlInput = page.getByPlaceholder(/https:\/\/… or \/modules\/…/)
  await expect(urlInput).toBeVisible()

  // A custom URL can be entered; it is used on the next Load (the load
  // button is still present and enabled).
  await urlInput.fill('/modules/kws/openwakeword/assets/openWakeWord/melspectrogram.onnx')
  const loadButton = page.getByRole('button', { name: /Load models/i })
  await expect(loadButton).toBeVisible()
})

test('local file import stores a saved model and it appears in the editor', async ({
  page,
}) => {
  await page.goto('/#/workspace')

  const classifierSelect = page.getByRole('combobox', {
    name: /Wake-word classifier/,
  })
  await expect(classifierSelect).toBeVisible()

  // The demo classifiers vendored in the module assets are now registry
  // entries too (issue: classifier must list all pretrained models in
  // packages/modules/kws/openwakeword/assets).
  await expect(
    classifierSelect.locator('option[value="openwakeword-alexa"]'),
  ).toHaveCount(1)
  await expect(
    classifierSelect.locator('option[value="openwakeword-hey-jarvis"]'),
  ).toHaveCount(1)

  // Import a local .onnx file via the hidden file input. The browser allows
  // setInputFiles on a hidden input.
  const fileInput = classifierSelect.locator('xpath=ancestor::div[contains(@class,"space-y-1")]//input[@type="file"]')
  await fileInput.setInputFiles({
    name: 'my-wakeword.onnx',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from([0x01, 0x02, 0x03, 0x04]),
  })

  // The freshly imported model is auto-selected and shows in "Saved models".
  await expect(
    classifierSelect.locator('option', { hasText: 'my-wakeword.onnx' }),
  ).toHaveCount(1)
  await expect(page.getByText(/Saved: my-wakeword\.onnx/)).toBeVisible()
})
