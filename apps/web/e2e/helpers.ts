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

/**
 * Pick an entry in a Radix select (UiSelect, role "combobox").
 *
 * All hand-written <select> elements were replaced with the Radix selector,
 * so e2e must open the trigger and click the portal option instead of
 * selectOption(). The trigger is found by its accessible name (aria-label).
 */
export async function selectRadixOption(
  page: Page,
  triggerName: string | RegExp,
  optionName: string | RegExp,
): Promise<void> {
  const trigger = page.getByRole('combobox', { name: triggerName })
  await expect(trigger).toBeVisible()
  await trigger.click()
  // String names match exactly (a substring id like 'openwakeword' must not
  // also match a longer sibling); regex callers keep substring semantics.
  const option =
    typeof optionName === 'string'
      ? page.getByRole('option', { name: optionName, exact: true })
      : page.getByRole('option', { name: optionName })
  await expect(option).toBeVisible()
  await option.click()
}

/** Pick a KWS backend in the KWS panel's backend selector. */
export async function selectBackend(page: Page, backendId: string): Promise<void> {
  await selectRadixOption(page, 'Backend', backendId)
}
