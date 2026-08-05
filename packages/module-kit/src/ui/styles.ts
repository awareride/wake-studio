/**
 * module-kit ui - shared styling helpers.
 *
 * Central place for the design tokens used by the spec-driven controls.
 * Uses SEMANTIC classes (bg-surface-2, text-ink-1, border-line, ...) defined
 * by the host app's Tailwind config (apps/web/tailwind.config.ts) so the
 * kit follows whatever theme the host uses (light or dark). These classes
 * must be present in the host's content scan (tailwind.config content).
 */

/** Merge class names, skipping falsy values. */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ')
}

/** Shared control shell: label row + control. */
export const LABEL_CLS = 'flex items-center justify-between gap-3 text-sm'

/** Base for buttons (primary / secondary / danger). */
export const BTN_BASE =
  'inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:opacity-40 disabled:pointer-events-none'

export const BTN_VARIANTS = {
  primary: 'bg-brand-600 text-white hover:bg-brand-500',
  secondary:
    'border border-line bg-surface-2 text-ink-2 hover:bg-surface-4/60',
  danger: 'bg-danger/90 text-white hover:bg-danger',
  ghost: 'text-ink-3 hover:text-ink-1',
} as const

/** Radix slider track/thumb styling (data-* attributes drive state). */
export const SLIDER_CLS = {
  root: 'relative flex h-5 w-full min-w-44 touch-none select-none items-center',
  track:
    'relative h-1.5 w-full grow overflow-hidden rounded-full bg-surface-4',
  range: 'absolute h-full rounded-full bg-brand-500',
  // Radix positions the thumb via inline left + translateX; it MUST be
  // absolutely positioned within the (relative) root or the knob visually
  // detaches from the value. top-1/2 -translate-y-1/2 centers it vertically.
  thumb:
    'absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-white shadow ring-1 ring-line-2 transition-colors hover:bg-brand-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400',
}

/** Radix switch (toggle) styling. */
export const SWITCH_CLS = {
  root: 'relative h-5 w-9 shrink-0 rounded-full bg-surface-4 transition-colors data-[state=checked]:bg-brand-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400',
  thumb:
    'block h-4 w-4 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[18px]',
}

/** Radix select trigger styling. */
export const SELECT_CLS = {
  trigger:
    'inline-flex h-8 w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-line bg-surface-3 px-2.5 text-sm text-ink-2 hover:bg-surface-4/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400',
  content:
    'z-50 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-line bg-surface-2 p-1 shadow-xl',
  item: 'cursor-default select-none rounded-md px-2.5 py-1.5 text-sm text-ink-2 outline-none data-[highlighted]:bg-brand-50 data-[highlighted]:text-ink-1',
}

/** Radix collapsible (Primary/Advanced dual layer, ADR-024). */
export const COLLAPSIBLE_CLS = {
  trigger:
    'inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-ink-3 hover:text-ink-1 transition-colors',
}
