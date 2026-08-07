/**
 * Console shell layout: left sidebar (desktop) + mobile drawer + top bar +
 * content. Wraps the routed views.
 */

import * as React from 'react'
import type { ConsoleRoute } from '../router'
import { Sidebar, TopBar } from './shell'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  TooltipProvider,
} from './ui'
import { useConsoleStatus } from '../status'

const VIEW_TITLES: Record<ConsoleRoute, string> = {
  workspace: 'Workspace',
  library: 'Model Library',
  projects: 'Projects',
  console: 'Session Console',
  'playground-rnnoise': 'RNNoise Playground',
  settings: 'Settings',
  'settings-general': 'Settings · General',
  'settings-security': 'Settings · Security',
  'settings-data': 'Settings · Data',
  'settings-modules': 'Settings · Modules',
  'device-sdk': 'Device SDK',
}

export function ConsoleShell({
  route,
  onNavigate,
  children,
}: {
  route: ConsoleRoute
  onNavigate: (r: ConsoleRoute) => void
  children: React.ReactNode
}) {
  const { status } = useConsoleStatus()
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false)

  const navigate = (r: ConsoleRoute) => {
    onNavigate(r)
    setMobileNavOpen(false)
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-screen flex-col overflow-hidden bg-surface">
        <div className="flex flex-1 overflow-hidden">
          {/* Desktop sidebar */}
          <aside className="hidden w-56 shrink-0 border-r border-line bg-surface-2/70 lg:block">
            <Sidebar route={route} onNavigate={navigate} />
          </aside>

          {/* Mobile drawer: left-edge slide-in panel (GitHub-style), not a
              centered dialog. Full-height, no rounding, animates from off-
              screen left. */}
          <Dialog open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
            <DialogContent
              centered={false}
              className="drawer-content left-0 top-0 h-screen w-[min(80vw,17rem)] max-w-[calc(100vw-2rem)] rounded-none border-l border-t-0 border-r-0 border-b-0 p-0 data-[state=open]:animate-[drawer-in_180ms_ease-out] data-[state=closed]:animate-[drawer-out_160ms_ease-in]"
            >
              <DialogTitle className="sr-only">Navigation</DialogTitle>
              <DialogDescription className="sr-only">
                Primary navigation
              </DialogDescription>
              <div className="flex h-full flex-col">
                {/* Close button pinned top-right of the drawer. */}
                <div className="flex justify-end border-b border-line px-3 py-2">
                  <DialogClose
                    className="rounded-md p-1.5 text-ink-3 transition-colors hover:bg-surface-3 hover:text-ink-1"
                    aria-label="Close navigation"
                  >
                    <svg
                      viewBox="0 0 16 16"
                      className="h-4 w-4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                    >
                      <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
                    </svg>
                  </DialogClose>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto">
                  <Sidebar route={route} onNavigate={navigate} />
                </div>
              </div>
            </DialogContent>
          </Dialog>

          {/* Main column */}
          <div className="flex min-w-0 flex-1 flex-col">
            <TopBar
              title={VIEW_TITLES[route]}
              status={status}
              onToggleSidebar={() => setMobileNavOpen(true)}
            />
            <main className="flex-1 overflow-y-auto">
              <div className="mx-auto max-w-6xl px-6 py-8">{children}</div>
            </main>
          </div>
        </div>
      </div>
    </TooltipProvider>
  )
}
