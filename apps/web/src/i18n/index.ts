/**
 * i18n - lightweight locale dictionary layer (English-first, per repo policy).
 *
 * Design:
 * - `en` needs no dictionary: strings render as-is (the source is the key).
 * - `zh-CN` is a `Record<string, string>` map; missing entries fall back to
 *   the English source so partial coverage never breaks the UI.
 * - No external i18n dependency; `useT()` reads the locale from the settings
 *   context (Settings -> General -> Language).
 *
 * Scope: user-visible UI copy only. Logs and error messages surfaced in the
 * log/console stay English (debug artifacts, per the repo language policy).
 */

import * as React from 'react'
import { useAppSettings } from '../settings/context'
import type { AppLocale } from '../settings/types'
import { ZH_CN } from './zh-CN'

export type { AppLocale }

export type T = (s: string) => string

const DICTS: Record<Exclude<AppLocale, 'en'>, Record<string, string>> = {
  'zh-CN': ZH_CN,
}

/** Translate a UI string for the given locale (English source = key). */
export function translate(locale: AppLocale, s: string): string {
  if (locale === 'en') return s
  return DICTS[locale]?.[s] ?? s
}

/**
 * React hook: returns a `t()` bound to the current locale. Components call
 * `t('Save')` etc.; English passes through untouched, other locales look up
 * the dictionary and fall back to English for missing entries.
 */
export function useT(): T {
  const { platform } = useAppSettings()
  const locale = platform.locale ?? 'en'
  return React.useCallback((s: string) => translate(locale, s), [locale])
}

/** Non-hook translation for module-level constants (render-time helpers). */
export function tFor(locale: AppLocale): T {
  return (s: string) => translate(locale, s)
}
