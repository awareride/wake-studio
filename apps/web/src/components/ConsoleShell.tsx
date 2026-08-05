/**
 * Console shell layout: left sidebar (desktop) + mobile drawer + top bar +
 * content. Wraps the routed views.
 */

import * as React from 'react'
import type { ConsoleRoute } from '../router'
import { Sidebar, TopBar } from './shell'
import {
  Dialog,
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

          {/* Mobile drawer */}
          <Dialog open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
            <DialogContent className="left-4 top-4 -translate-x-0 -translate-y-0 w-[min(80vw,17rem)] p-0">
              <DialogTitle className="sr-only">Navigation</DialogTitle>
              <DialogDescription className="sr-only">
                Primary navigation
              </DialogDescription>
              <Sidebar route={route} onNavigate={navigate} />
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
