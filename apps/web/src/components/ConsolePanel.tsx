/**
 * ConsolePanel — shared list-detail layout for the console views
 * (Trains / Backends / Projects).
 *
 * One layout, three consumers: a header (title + description + toolbar
 * actions), a collapsible left rail (toggle + title + count + rail actions,
 * e.g. "Check health"), a right details pane, and a mobile drawer for the
 * rail. Full-panel modes (wizard / editor / guide) live OUTSIDE this
 * component — the view renders them instead of the panel.
 *
 * The `rail` render-prop receives `close` (closes the mobile drawer; a no-op
 * on desktop) so each view can wire selection to close the drawer.
 */

import * as React from 'react'
import { IconButton } from '@radix-ui/themes'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui'
import { IconMenu } from './icons'
import { useIsDesktop } from '../training/console/useIsDesktop'

export interface ConsolePanelProps {
  /** Header title (e.g. "Training", "Backends", "Projects"). */
  title: string
  /** One-line description under the title. */
  description?: React.ReactNode
  /** Toolbar on the right of the header (New, Free On Google Colab…). */
  actions?: React.ReactNode
  /** Left rail header title (defaults to `title`). */
  railTitle?: string
  /** Count badge (circle) in the rail header; hidden when 0/undefined. */
  railCount?: number
  /** Extra controls in the rail header (e.g. "Check health"). */
  railActions?: React.ReactNode
  /**
   * The rail list content. `close` closes the mobile drawer — call it from
   * the items' selection handler (no-op on desktop).
   */
  rail: (close: () => void) => React.ReactNode
  /** Right details pane content. */
  details: React.ReactNode
  /** Details empty state (nothing selected). */
  detailsEmpty: React.ReactNode
}

export function ConsolePanel({
  title,
  description,
  actions,
  railTitle = title,
  railCount,
  railActions,
  rail,
  details,
  detailsEmpty,
}: ConsolePanelProps) {
  const isDesktop = useIsDesktop()
  const [railCollapsed, setRailCollapsed] = React.useState(false)
  const [drawerOpen, setDrawerOpen] = React.useState(false)

  const handleRailToggle = React.useCallback(() => {
    if (isDesktop) setRailCollapsed((c) => !c)
    else setDrawerOpen(true)
  }, [isDesktop])

  const closeDrawer = React.useCallback(() => setDrawerOpen(false), [])

  return (
    <div className="flex h-[calc(100dvh-7.5rem)] min-h-[24rem] flex-col gap-6">
      {/* Header (hidden by the view when a full-panel mode is open). */}
      <div className="flex shrink-0 items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-ink-1">{title}</h2>
          {description && (
            <p className="mt-1 max-w-2xl text-sm text-ink-2">{description}</p>
          )}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>

      {/* Split-scroll: left rail + right details. */}
      <div className="flex min-h-0 flex-1 gap-6">
        {!railCollapsed && (
          <aside className="hidden min-h-0 w-72 shrink-0 flex-col border-r border-line lg:flex">
            {/* Rail header (menu toggle + title + count + extra actions). */}
            <div className="flex items-center gap-1.5 px-4 pb-2 pt-3">
              <IconButton
                type="button"
                onClick={handleRailToggle}
                aria-label={`Toggle ${railTitle.toLowerCase()} list`}
                variant="ghost"
                size="1"
                className="text-ink-3"
              >
                <IconMenu className="h-4 w-4" />
              </IconButton>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-3">
                {railTitle}
              </h3>
              {(railCount !== undefined || railActions) && (
                <div className="ml-auto flex items-center gap-1.5">
                  {railCount !== undefined && railCount > 0 && (
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-surface-3 text-[9px] leading-none text-ink-3">
                      {railCount}
                    </span>
                  )}
                  {railActions}
                </div>
              )}
            </div>
            {/* Scrollable rail content. */}
            <div className="min-h-0 flex-1 overflow-y-auto">{rail(closeDrawer)}</div>
          </aside>
        )}

        {/* Right details pane (own scroll). */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Re-open the rail when hidden (sidebar-trigger pattern). */}
          {(!isDesktop || railCollapsed) && (
            <div className="mb-2 flex shrink-0 items-center gap-2">
              <IconButton
                type="button"
                onClick={handleRailToggle}
                aria-label={isDesktop ? `Show ${railTitle.toLowerCase()} list` : `Open ${railTitle.toLowerCase()} list`}
                variant="ghost"
                size="1"
                className="text-ink-3"
              >
                <IconMenu className="h-4 w-4" />
              </IconButton>
              <span className="text-[11px] text-ink-3">{railTitle}</span>
            </div>
          )}
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
            {details ?? detailsEmpty}
          </div>
        </div>
      </div>

      {/* Mobile drawer (matches the shell's sidebar pattern). */}
      <Dialog open={drawerOpen} onOpenChange={setDrawerOpen}>
        <DialogContent
          centered={false}
          className="drawer-content left-0 top-0 h-screen w-[min(80vw,18rem)] max-w-[calc(100vw-2rem)] rounded-r-xl border-l border-t-0 border-r-0 border-b-0 p-0 data-[state=open]:animate-[drawer-in_180ms_ease-out] data-[state=closed]:animate-[drawer-out_160ms_ease-in]"
        >
          <DialogTitle className="sr-only">{railTitle} list</DialogTitle>
          <DialogDescription className="sr-only">Your {railTitle.toLowerCase()} list</DialogDescription>
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-ink-3">
              {railTitle}
            </span>
            <IconButton
              type="button"
              onClick={() => setDrawerOpen(false)}
              aria-label={`Close ${railTitle.toLowerCase()} list`}
              variant="ghost"
              size="1"
              className="text-ink-3"
            >
              ✕
            </IconButton>
          </div>
          <div className="flex-1 overflow-y-auto">{rail(closeDrawer)}</div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default ConsolePanel
