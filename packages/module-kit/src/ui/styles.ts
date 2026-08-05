/**
 * module-kit ui - shared Tailwind + Radix styling helpers.
 *
 * Central place for the design tokens used by the spec-driven controls.
 * Kept as plain class strings so tailwind can scan them (the packages/*
 * sources are added to tailwind.config content).
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
  primary: 'bg-brand-500 text-white hover:bg-brand-400',
  secondary:
    'border border-white/10 bg-white/[0.03] text-slate-300 hover:bg-white/[0.07]',
  danger: 'bg-red-500/80 text-white hover:bg-red-500',
  ghost: 'text-slate-400 hover:text-slate-200',
} as const

/** Radix slider track/thumb styling (data-* attributes drive state). */
export const SLIDER_CLS = {
  root: 'relative flex h-5 w-full touch-none select-none items-center',
  track:
    'relative h-1.5 w-full grow overflow-hidden rounded-full bg-slate-700/60',
  range: 'absolute h-full rounded-full bg-brand-500',
  thumb:
    'block h-4 w-4 rounded-full bg-white shadow ring-1 ring-slate-900/10 transition-colors hover:bg-brand-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400',
}

/** Radix switch (toggle) styling. */
export const SWITCH_CLS = {
  root: 'relative h-5 w-9 shrink-0 rounded-full bg-slate-700 transition-colors data-[state=checked]:bg-brand-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400',
  thumb:
    'block h-4 w-4 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[18px]',
}

/** Radix select trigger styling. */
export const SELECT_CLS = {
  trigger:
    'inline-flex h-8 w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-white/10 bg-slate-800/60 px-2.5 text-sm text-slate-300 hover:bg-slate-800/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400',
  content:
    'z-50 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-white/10 bg-slate-900 p-1 shadow-xl',
  item: 'cursor-default select-none rounded-md px-2.5 py-1.5 text-sm text-slate-300 outline-none data-[highlighted]:bg-brand-500/20 data-[highlighted]:text-white',
}

/** Radix collapsible (Primary/Advanced dual layer, ADR-024). */
export const COLLAPSIBLE_CLS = {
  trigger:
    'inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-slate-500 hover:text-slate-300 transition-colors',
}
