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

/**
 * Translate the user-facing strings of a train-panel spec (labels,
 * descriptions, option labels, action labels) at the host call site. Spec
 * JSON stays English; this maps a shallow copy for rendering.
 */
export function translateTrainSpec<S extends Record<string, unknown>>(spec: S, t: T): S {
  const params = (spec['params'] as ModuleParamLike[] | undefined)?.map((p) => ({
    ...p,
    label: t(p.label),
    description: p.description ? t(p.description) : p.description,
    options: p.options?.map((o: string | { value: string; label: string }) =>
      typeof o === 'string' ? o : { ...o, label: t(o.label) },
    ),
  }))
  const actions = (spec['actions'] as { id: string; label: string }[] | undefined)?.map((a) => ({
    ...a,
    label: t(a.label),
  }))
  const status = (spec['status'] as { id: string; label: string }[] | undefined)?.map((s) => ({
    ...s,
    label: t(s.label),
  }))
  return {
    ...spec,
    ...(spec['name'] !== undefined ? { name: t(String(spec['name'])) } : null),
    params,
    actions,
    status,
  } as S
}

interface ModuleParamLike {
  id: string
  label: string
  description?: string
  options?: ReadonlyArray<string | { value: string; label: string }>
}
