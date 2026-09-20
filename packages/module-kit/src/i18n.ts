/**
 * module-kit i18n seam.
 *
 * module-kit stays dependency-free (no host imports), so the host registers
 * a translate function at startup (`setUiTranslator`); the generated panel
 * renders its fixed copy ("Advanced", "Confirm?", "Open in Colab") through
 * it. Unregistered -> identity (English, the default).
 */

export type UiTranslator = (s: string) => string

let translator: UiTranslator | undefined

/** Register the host's translate function (called once per locale change). */
export function setUiTranslator(fn: UiTranslator | undefined): void {
  translator = fn
}

/** Translate a module-kit UI string through the registered translator. */
export function uiT(s: string): string {
  return translator ? translator(s) : s
}
