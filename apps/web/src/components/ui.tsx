/**
 * Radix shell components (App shell layer).
 *
 * Thin, styled adapters over Radix Primitives / Radix Themes for the console
 * shell - navigation, modals, menus, hints, notifications. These are NOT part
 * of the spec-driven layer (ADR-025 keeps that pure in `module-kit`); they are
 * the shell's own building blocks.
 *
 * - Dialog, buttons, cards, inputs... use Radix Themes components (styling
 *   comes from the Theme provider + Radix Colors tokens).
 * - DropdownMenu, Tooltip, Toast stay on Radix Primitives (already themed via
 *   the `--ws-*` tokens; behavior-critical for e2e).
 *
 * Note: Radix Themes' CSS is unlayered, so it beats Tailwind utilities in the
 * cascade. Where we need to override Themes defaults (dialog width/padding,
 * drawer positioning) we use Tailwind's `!` (important) modifier - see
 * DialogContent.
 */

import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import * as DropdownPrimitive from '@radix-ui/react-dropdown-menu'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import * as ToastPrimitive from '@radix-ui/react-toast'
import * as Themes from '@radix-ui/themes'
import { cn } from './cn'
import { IconMenu } from './icons'

// ---------------------------------------------------------------------------
// Dialog (Radix Themes - bundled overlay + content, themes motion/styling)
// ---------------------------------------------------------------------------
export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogClose = DialogPrimitive.Close

export const DialogContent = React.forwardRef<
  React.ElementRef<typeof Themes.Dialog.Content>,
  React.ComponentPropsWithoutRef<typeof Themes.Dialog.Content> & {
    /** Center on screen (default). When false, the content is a left-edge
     *  side drawer (mobile nav / train list). */
    centered?: boolean
  }
>(({ className, centered = true, ...props }, ref) => (
  <Themes.Dialog.Content
    ref={ref}
    className={cn(
      // Themes CSS is unlayered -> width/padding overrides need `!`.
      centered
        ? '!w-[min(92vw,26rem)]'
        : '!fixed left-0 top-0 h-screen !w-[min(80vw,17rem)] !p-0',
      className,
    )}
    {...props}
  />
))
DialogContent.displayName = 'DialogContent'

export const DialogTitle = React.forwardRef<
  React.ElementRef<typeof Themes.Dialog.Title>,
  React.ComponentPropsWithoutRef<typeof Themes.Dialog.Title>
>(({ className, ...props }, ref) => (
  <Themes.Dialog.Title ref={ref} className={className} {...props} />
))
DialogTitle.displayName = 'DialogTitle'

export const DialogDescription = React.forwardRef<
  React.ElementRef<typeof Themes.Dialog.Description>,
  React.ComponentPropsWithoutRef<typeof Themes.Dialog.Description>
>(({ className, ...props }, ref) => (
  <Themes.Dialog.Description ref={ref} className={className} {...props} />
))
DialogDescription.displayName = 'DialogDescription'

// ---------------------------------------------------------------------------
// Dropdown menu (Radix primitive, token-styled)
// ---------------------------------------------------------------------------
export const DropdownMenu = DropdownPrimitive.Root
export const DropdownMenuTrigger = DropdownPrimitive.Trigger
export const DropdownMenuContent = React.forwardRef<
  React.ElementRef<typeof DropdownPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <DropdownPrimitive.Portal>
    <DropdownPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'z-50 min-w-44 overflow-hidden rounded-lg border border-line bg-surface-2 p-1 shadow-xl',
        'animate-in fade-in-0 zoom-in-95',
        className,
      )}
      {...props}
    />
  </DropdownPrimitive.Portal>
))
DropdownMenuContent.displayName = 'DropdownMenuContent'
export const DropdownMenuItem = React.forwardRef<
  React.ElementRef<typeof DropdownPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownPrimitive.Item>
>(({ className, ...props }, ref) => (
  <DropdownPrimitive.Item
    ref={ref}
    className={cn(
      'flex cursor-pointer select-none items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-ink-2 outline-none',
      'hover:bg-surface-3 hover:text-ink-1 focus:bg-surface-3 focus:text-ink-1',
      'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      className,
    )}
    {...props}
  />
))
DropdownMenuItem.displayName = 'DropdownMenuItem'
export const DropdownMenuSeparator = React.forwardRef<
  React.ElementRef<typeof DropdownPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof DropdownPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <DropdownPrimitive.Separator
    ref={ref}
    className={cn('my-1 h-px bg-line', className)}
    {...props}
  />
))
DropdownMenuSeparator.displayName = 'DropdownMenuSeparator'

// ---------------------------------------------------------------------------
// Tooltip (Radix primitive, token-styled)
// ---------------------------------------------------------------------------
export const TooltipProvider = TooltipPrimitive.Provider
export const Tooltip = TooltipPrimitive.Root
export const TooltipTrigger = TooltipPrimitive.Trigger
export const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 6, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'z-50 rounded-md border border-line bg-ink-1 px-2.5 py-1 text-xs text-surface-2 shadow-lg',
        'animate-in fade-in-0 zoom-in-95',
        className,
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
))
TooltipContent.displayName = 'TooltipContent'

// ---------------------------------------------------------------------------
// Toast (Radix primitive, token-styled)
// ---------------------------------------------------------------------------
export const ToastProvider = ToastPrimitive.Provider
export const ToastViewport = React.forwardRef<
  React.ElementRef<typeof ToastPrimitive.Viewport>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Viewport>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Viewport
    ref={ref}
    className={cn(
      'fixed bottom-0 right-0 z-[60] flex w-full max-w-sm flex-col gap-2 p-4 outline-none',
      className,
    )}
    {...props}
  />
))
ToastViewport.displayName = 'ToastViewport'
export const Toast = React.forwardRef<
  React.ElementRef<typeof ToastPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Root>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Root
    ref={ref}
    className={cn(
      'rounded-lg border border-line bg-surface-2 p-4 shadow-xl',
      'data-[state=open]:animate-in data-[state=closed]:animate-out',
      className,
    )}
    {...props}
  />
))
Toast.displayName = 'Toast'
export const ToastTitle = React.forwardRef<
  React.ElementRef<typeof ToastPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Title>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Title
    ref={ref}
    className={cn('text-sm font-semibold text-ink-1', className)}
    {...props}
  />
))
ToastTitle.displayName = 'ToastTitle'
export const ToastDescription = React.forwardRef<
  React.ElementRef<typeof ToastPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Description>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Description
    ref={ref}
    className={cn('mt-0.5 text-xs text-ink-2', className)}
    {...props}
  />
))
ToastDescription.displayName = 'ToastDescription'

// ---------------------------------------------------------------------------
// Sidebar trigger (uses IconMenu)
// ---------------------------------------------------------------------------
export function SidebarTrigger({ className }: { className?: string }) {
  return (
    <IconMenu className={cn('h-4 w-4', className)} />
  )
}
