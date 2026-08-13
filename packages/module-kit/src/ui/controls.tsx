/**
 * module-kit ui - spec-driven controls (ADR-025).
 *
 * Thin adapters over Radix Primitives + Tailwind, mapped 1:1 from
 * ModuleSpec param types (docs/module-spec.md §3). The panel generator calls
 * these; a new control type requires a spec change, not a new panel.
 *
 * Each control is fully controlled (value + onChange) so the generator can
 * own the module state.
 */

import { useId } from 'react'
import type { ReactNode } from 'react'
import * as SliderPrimitive from '@radix-ui/react-slider'
import * as SelectPrimitive from '@radix-ui/react-select'
import * as SwitchPrimitive from '@radix-ui/react-switch'
import * as ProgressPrimitive from '@radix-ui/react-progress'
import * as CollapsiblePrimitive from '@radix-ui/react-collapsible'
import { cn, BTN_BASE, BTN_VARIANTS, SLIDER_CLS, SWITCH_CLS, SELECT_CLS, COLLAPSIBLE_CLS } from './styles'

// ---------------------------------------------------------------------------
// Slider (param type: slider | number)
// ---------------------------------------------------------------------------

export interface UiSliderProps {
  value: number
  min: number
  max: number
  step?: number
  onChange: (value: number) => void
  disabled?: boolean
  ariaLabel?: string
}

/** Two-way slider with a live numeric readout. */
export function UiSlider({ value, min, max, step = 1, onChange, disabled, ariaLabel }: UiSliderProps) {
  const id = useId()
  return (
    <div className="flex w-full items-center gap-3">
      <SliderPrimitive.Root
        className={cn(SLIDER_CLS.root, 'min-w-44', disabled && 'opacity-40 pointer-events-none')}
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={(v) => onChange(v[0])}
        disabled={disabled}
        aria-label={ariaLabel}
      >
        <SliderPrimitive.Track className={SLIDER_CLS.track}>
          <SliderPrimitive.Range className={SLIDER_CLS.range} />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb className={SLIDER_CLS.thumb} />
      </SliderPrimitive.Root>
      <span
        id={id}
        className="w-12 shrink-0 text-right font-mono text-xs text-ink-2 tabular-nums"
      >
        {formatNumber(value)}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Number (param type: number - plain numeric input with +/- stepping)
// ---------------------------------------------------------------------------

export interface UiNumberProps {
  value: number
  min?: number
  max?: number
  step?: number
  unit?: string
  onChange: (value: number) => void
  disabled?: boolean
}

/** Numeric input with a stepper (for params that want precise entry). */
export function UiNumber({ value, min, max, step = 1, unit, onChange, disabled }: UiNumberProps) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        value={Number.isFinite(value) ? value : ''}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const n = Number(e.target.value)
          if (Number.isFinite(n)) onChange(n)
        }}
        disabled={disabled}
        className="h-8 w-24 rounded-lg border border-line bg-surface-3 px-2.5 text-right font-mono text-sm text-ink-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-8 disabled:opacity-40"
      />
      {unit && <span className="text-xs text-ink-3">{unit}</span>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Select (param type: select | enum)
// ---------------------------------------------------------------------------

export interface UiSelectOption {
  value: string
  label: string
}

export interface UiSelectProps {
  value: string
  options: ReadonlyArray<UiSelectOption>
  onChange: (value: string) => void
  disabled?: boolean
  placeholder?: string
}

/** Radix select (single). */
export function UiSelect({ value, options, onChange, disabled, placeholder = 'Select…' }: UiSelectProps) {
  return (
    <SelectPrimitive.Root
      value={value}
      onValueChange={onChange}
      disabled={disabled}
    >
      <SelectPrimitive.Trigger className={cn(SELECT_CLS.trigger, disabled && 'opacity-40')}>
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon className="text-ink-3">
          <ChevronDown className="h-3.5 w-3.5" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content className={SELECT_CLS.content} position="popper" sideOffset={4}>
          <SelectPrimitive.Viewport>
            {options.map((opt) => (
              <SelectPrimitive.Item key={opt.value} value={opt.value} className={SELECT_CLS.item}>
                <SelectPrimitive.ItemText>{opt.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="ml-2 inline-flex text-brand-11">
                  <Check className="h-3.5 w-3.5" />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  )
}

// ---------------------------------------------------------------------------
// Toggle (param type: boolean)
// ---------------------------------------------------------------------------

export interface UiToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  label?: string
}

/** Radix switch (toggle). */
export function UiToggle({ checked, onChange, disabled, label }: UiToggleProps) {
  return (
    <SwitchPrimitive.Root
      className={cn(SWITCH_CLS.root, disabled && 'opacity-40 pointer-events-none')}
      checked={checked}
      onCheckedChange={onChange}
      disabled={disabled}
      aria-label={label}
    >
      <SwitchPrimitive.Thumb className={SWITCH_CLS.thumb} />
    </SwitchPrimitive.Root>
  )
}

// ---------------------------------------------------------------------------
// Button (action kind)
// ---------------------------------------------------------------------------

export type UiButtonVariant = keyof typeof BTN_VARIANTS

export interface UiButtonProps {
  label: string
  onClick: () => void
  variant?: UiButtonVariant
  disabled?: boolean
  icon?: ReactNode
}

/** Action button (maps ModuleAction.kind to a visual variant). */
export function UiButton({ label, onClick, variant = 'secondary', disabled, icon }: UiButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(BTN_BASE, BTN_VARIANTS[variant])}
    >
      {icon}
      {label}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Progress (action progress)
// ---------------------------------------------------------------------------

export interface UiProgressProps {
  value: number // 0..100
  indeterminate?: boolean
}

/** Progress bar (determinate or indeterminate). */
export function UiProgress({ value, indeterminate }: UiProgressProps) {
  return (
    <ProgressPrimitive.Root
      className="relative h-1.5 w-full overflow-hidden rounded-full bg-surface-3"
      value={indeterminate ? undefined : value}
    >
      <ProgressPrimitive.Indicator
        className={cn(
          'h-full w-full bg-brand-9 transition-transform',
          indeterminate && 'animate-pulse',
        )}
        style={{ transform: `translateX(-${100 - (indeterminate ? 40 : value)}%)` }}
      />
    </ProgressPrimitive.Root>
  )
}

// ---------------------------------------------------------------------------
// Collapsible (Primary/Advanced dual layer, ADR-024)
// ---------------------------------------------------------------------------

export interface UiCollapsibleProps {
  label: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children: ReactNode
}

/** Collapsible section - the "Advanced" layer of a panel. */
export function UiCollapsible({ label, open, onOpenChange, children }: UiCollapsibleProps) {
  return (
    <CollapsiblePrimitive.Root open={open} onOpenChange={onOpenChange}>
      <CollapsiblePrimitive.Trigger className={cn(COLLAPSIBLE_CLS.trigger, 'group')}>
        <ChevronRight className="h-3.5 w-3.5 transition-transform group-data-[state=open]:rotate-90" />
        {label}
      </CollapsiblePrimitive.Trigger>
      <CollapsiblePrimitive.Content className="mt-2 overflow-hidden data-[state=closed]:hidden">
        {children}
      </CollapsiblePrimitive.Content>
    </CollapsiblePrimitive.Root>
  )
}

// ---------------------------------------------------------------------------
// Stat / label shell
// ---------------------------------------------------------------------------

export interface UiParamRowProps {
  label: string
  description?: string
  children: ReactNode
}

/** One parameter row: label + description left, control right. */
export function UiParamRow({ label, description, children }: UiParamRowProps) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div className="min-w-0">
        <div className="text-sm text-ink-2">{label}</div>
        {description && <div className="mt-0.5 text-xs text-ink-3">{description}</div>}
      </div>
      {/* Controls that need width (sliders) must not be collapsed; allow them
          to grow but keep a sensible cap so labels stay readable. */}
      <div className="shrink-0 grow-0 basis-auto">{children}</div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Small inline icons (avoid an icon dependency)
// ---------------------------------------------------------------------------

function ChevronDown({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ChevronRight({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M6 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function Check({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 8.5l3 3 7-7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatNumber(n: number): string {
  if (Number.isInteger(n)) return String(n)
  // Sliders often use small steps; show up to 2 decimals, strip trailing zeros.
  return n.toFixed(2).replace(/\.?0+$/, '')
}
