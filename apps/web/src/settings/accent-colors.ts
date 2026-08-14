/**
 * Accent theme scales - Radix Colors (https://www.radix-ui.com/colors).
 *
 * The `brand-*` Tailwind scale is backed by `--ws-brand-1..12` CSS vars so
 * module-kit rendered panels (spec-driven controls, ADR-025) and the shell
 * follow the user's accent theme from Settings -> General -> Accent color,
 * not a hard-coded sky. This module syncs those vars to the chosen Radix
 * scale (values stored as rgb() TRIPLES so Tailwind opacity modifiers like
 * bg-brand-9/10 keep working).
 */

import { jade, gray, indigo, orange, mint, sky } from '@radix-ui/colors'
import {
  jadeDark,
  grayDark,
  indigoDark,
  orangeDark,
  mintDark,
  skyDark,
} from '@radix-ui/colors'
import type { AccentTheme } from './types'

/** #rrggbb -> "r g b" (Tailwind <alpha-value> triple format). */
function toTriple(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`
}

function toScale(name: string, colors: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (let i = 1; i <= 12; i++) {
    out[String(i)] = toTriple(colors[`${name}${i}`])
  }
  return out
}

/** rgb-triple values for each accent scale (steps 1-12, light theme). */
export const ACCENT_SCALE_TRIPLES: Record<AccentTheme, Record<string, string>> = {
  jade: toScale('jade', jade),
  gray: toScale('gray', gray),
  indigo: toScale('indigo', indigo),
  orange: toScale('orange', orange),
  mint: toScale('mint', mint),
  sky: toScale('sky', sky),
}

/** rgb-triple values for each accent scale (steps 1-12, dark theme). */
export const ACCENT_SCALE_DARK_TRIPLES: Record<AccentTheme, Record<string, string>> = {
  jade: toScale('jade', jadeDark),
  gray: toScale('gray', grayDark),
  indigo: toScale('indigo', indigoDark),
  orange: toScale('orange', orangeDark),
  mint: toScale('mint', mintDark),
  sky: toScale('sky', skyDark),
}

/**
 * Sync the `--ws-brand-light-N` / `--ws-brand-dark-N` CSS vars to the given
 * accent scale (no-op outside the browser). The active `--ws-brand-N` picks
 * light or dark via the `[data-theme='dark']` rule in index.css, so the
 * whole app - including module-kit rendered panels - follows the selected
 * theme and accent.
 */
export function setBrandAccentVars(accent: AccentTheme): void {
  if (typeof document === 'undefined') return
  const light = ACCENT_SCALE_TRIPLES[accent]
  const dark = ACCENT_SCALE_DARK_TRIPLES[accent]
  for (let i = 1; i <= 12; i++) {
    document.documentElement.style.setProperty(`--ws-brand-light-${i}`, light[String(i)])
    document.documentElement.style.setProperty(`--ws-brand-dark-${i}`, dark[String(i)])
  }
}
