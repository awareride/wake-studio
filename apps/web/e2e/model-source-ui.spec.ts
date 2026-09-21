import { test, expect } from '@playwright/test'
import { enableKws, selectRadixOption } from './helpers'

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
  await enableKws(page)

  // The block and the per-role selector render.
  await expect(page.getByText('Model sources')).toBeVisible()
  const melSelect = page.getByRole('combobox', { name: /Mel front-end/ })
  await expect(melSelect).toBeVisible()

  // The built-in registry candidates are available (registry is local JSON).
  // Radix renders options in a portal on open (role "option").
  await melSelect.click()
  await expect(page.getByRole('option', { name: /melspectrogram/ })).toBeVisible()
  await page.keyboard.press('Escape')
  const classifierSelect = page.getByRole('combobox', {
    name: /Wake-word classifier/,
  })
  await expect(classifierSelect).toBeVisible()
  // hey-buddy is the default classifier; the openwakeword demo classifiers
  // are also candidates if they were registered.
  await classifierSelect.click()
  await expect(page.getByRole('option', { name: /hey-buddy/ })).toBeVisible()
  await page.keyboard.press('Escape')

  // Choosing "Custom URL…" reveals the URL input.
  await selectRadixOption(page, /Mel front-end/, /Custom URL/)
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

  await enableKws(page)

  const classifierSelect = page.getByRole('combobox', {
    name: /Wake-word classifier/,
  })
  await expect(classifierSelect).toBeVisible()

  // The demo classifiers vendored in the module assets are now registry
  // entries too (issue: classifier must list all pretrained models in
  // packages/modules/kws/openwakeword/assets).
  await classifierSelect.click()
  await expect(
    page.getByRole('option', { name: /openwakeword-alexa/ }),
  ).toBeVisible()
  await expect(
    page.getByRole('option', { name: /openwakeword-hey-jarvis/ }),
  ).toBeVisible()
  await page.keyboard.press('Escape')

  // Import a local .onnx file via the hidden file input. The browser allows
  // setInputFiles on a hidden input.
  const fileInput = page.locator('[data-testid="model-source-classifier"] input[type="file"]')
  await fileInput.setInputFiles({
    name: 'my-wakeword.onnx',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from([0x01, 0x02, 0x03, 0x04]),
  })

  // The freshly imported model is auto-selected and shows in "Saved models".
  await expect(page.getByText(/Saved: my-wakeword\.onnx/)).toBeVisible()
  await classifierSelect.click()
  await expect(
    page.getByRole('option', { name: /my-wakeword\.onnx/ }),
  ).toBeVisible()
  await page.keyboard.press('Escape')
})
