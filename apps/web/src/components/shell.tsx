/**
 * Console shell: left sidebar + top bar + content (IDE-style, Q-C1).
 *
 * Layout (desktop): fixed left sidebar (logo + primary nav) + top bar
 * (view title + global status) + scrollable content. Mobile: sidebar
 * collapses into a Radix Dialog drawer.
 *
 * All shell interaction goes through Radix (tabs/dialog/tooltip); no
 * hand-rolled nav state.
 */

import * as React from 'react'
import type { ConsoleRoute } from '../router'
import {
  settingsSectionOf,
  settingsHash,
  settingsBackendFromHash,
} from '../router'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from './ui'
import { PRIMARY_NAV, SECONDARY_NAV, isSettingsRoute, type NavItem } from './shell-nav'
import type { ConsoleStatus } from '../status'
import { useProjects } from '../projects'
import { NewProjectDialog } from './NewProjectDialog'
import { cn } from './cn'
import { getBackendRegistry } from '@wake-studio/module-kws-engine'

function Logo() {
  return (
    <svg viewBox="0 0 512 512" className="h-7 w-7" role="img" aria-label="WakeStudio logo">
      <rect width="512" height="512" rx="96" fill="#0284c7" />
      <g stroke="#e0f2fe" strokeLinecap="round" fill="none">
        <line x1="160" y1="224" x2="160" y2="288" strokeWidth="20" />
        <line x1="208" y1="176" x2="208" y2="336" strokeWidth="20" />
        <line x1="256" y1="128" x2="256" y2="384" strokeWidth="24" />
        <line x1="304" y1="176" x2="304" y2="336" strokeWidth="20" />
        <line x1="352" y1="224" x2="352" y2="288" strokeWidth="20" />
      </g>
    </svg>
  )
}

function NavButton({
  item,
  active,
  onClick,
}: {
  item: NavItem
  active: boolean
  onClick: () => void
}) {
  const Icon = item.icon
  return (
    <Tooltip delayDuration={400}>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          aria-current={active ? 'page' : undefined}
          className={cn(
            'group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors',
            active
              ? 'bg-brand-500/10 text-brand-700'
              : 'text-ink-2 hover:bg-surface-3 hover:text-ink-1',
          )}
        >
          <Icon className="h-[18px] w-[18px] shrink-0" />
          <span className="flex-1 truncate text-left">{item.label}</span>
          {item.badge && (
            <span className="rounded bg-surface-4 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-3">
              {item.badge}
            </span>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  )
}

/**
 * Render the Settings parent + its expanded sub-menu. The parent is a single
 * full-width button (icon + label + chevron) that only toggles open/closed -
 * no navigation. Clicking a sub-item navigates. Hover covers the whole row.
 */
function SettingsNav({
  item,
  route,
  onNavigate,
  drivers,
  settingsBackend,
}: {
  item: NavItem
  route: ConsoleRoute
  onNavigate: (r: ConsoleRoute) => void
  drivers: ReadonlyArray<{ backendId: string; label: string }>
  settingsBackend?: string
}) {
  const isOpen = isSettingsRoute(route)
  const activeSection = settingsSectionOf(route)
  const [open, setOpen] = React.useState(isOpen)
  // Keep the sub-menu open when navigating within settings.
  React.useEffect(() => {
    if (isOpen) setOpen(true)
  }, [isOpen])

  const Icon = item.icon
  const driversActive = activeSection === 'modules'

  // Settings -> xxx: sections first, then drivers directly (no Modules layer).
  const sections = (item.children ?? []).filter(
    (c) => c.route !== 'settings-modules',
  )

  return (
    <div>
      {/* Parent: toggles open/closed only, no navigation. */}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={`Settings menu ${open ? 'collapsed' : 'expanded'}`}
        className={cn(
          'group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors',
          'text-ink-2 hover:bg-surface-3 hover:text-ink-1',
        )}
      >
        <Icon className="h-[18px] w-[18px] shrink-0" />
        <span className="flex-1 truncate text-left">{item.label}</span>
        <svg
          viewBox="0 0 16 16"
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-ink-3 transition-transform group-hover:text-ink-1',
            open && 'rotate-90',
          )}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path d="M6 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="ml-3 mt-0.5 space-y-0.5 border-l border-line pl-2">          {sections.map((child) => {
            const childActive = activeSection === settingsSectionOf(child.route)
            return (
              <button
                key={child.route}
                onClick={() => onNavigate(child.route)}
                aria-current={childActive ? 'page' : undefined}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[13px] transition-colors',
                  childActive
                    ? 'bg-brand-500/10 text-brand-700'
                    : 'text-ink-3 hover:bg-surface-3 hover:text-ink-1',
                )}
              >
                <span className="flex-1 truncate text-left">{child.label}</span>
              </button>
            )
          })}

          {/* Drivers: Settings -> driver (keeps focus on the clicked one). */}
          {drivers.map((d) => {
            const active = driversActive && d.backendId === settingsBackend
            return (
              <button
                key={d.backendId}
                onClick={() => {
                  window.location.hash = settingsHash('modules', d.backendId)
                }}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex w-full items-center gap-2 truncate rounded-md px-2 py-1.5 text-[13px] transition-colors',
                  active
                    ? 'bg-brand-500/10 text-brand-700'
                    : 'text-ink-3 hover:bg-surface-3 hover:text-ink-1',
                )}
              >
                <span className="flex-1 truncate text-left">{d.label}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function NavSection({ title, items, route, onNavigate }: {
  title: string
  items: NavItem[]
  route: ConsoleRoute
  onNavigate: (r: ConsoleRoute) => void
}) {
  return (
    <div className="space-y-0.5">
      <div className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-widest text-ink-3">
        {title}
      </div>
      {items.map((item) => (
        <NavButton
          key={item.route}
          item={item}
          active={route === item.route}
          onClick={() => onNavigate(item.route)}
        />
      ))}
    </div>
  )
}

export function Sidebar({
  route,
  onNavigate,
  onClose,
}: {
  route: ConsoleRoute
  onNavigate: (r: ConsoleRoute) => void
  /** When set (mobile drawer), renders a Close button beside the logo. */
  onClose?: () => void
}) {
  const drivers = useSettingsDrivers()
  // Current driver anchor (Settings -> driver focus).
  const [settingsBackend, setSettingsBackend] = React.useState<string | undefined>(
    () => settingsBackendFromHash(window.location.hash),
  )
  React.useEffect(() => {
    const onHash = () =>
      setSettingsBackend(settingsBackendFromHash(window.location.hash))
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  return (
    <div className="flex h-full w-full flex-col gap-1 overflow-y-auto p-3">
      <div className="mb-2 flex items-center gap-2 px-1.5">
        <Logo />
        <div className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="text-sm font-semibold tracking-tight text-ink-1">
            WakeStudio
          </span>
          <span className="text-[11px] text-ink-3">on-device KWS studio</span>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            aria-label="Close navigation"
            className="rounded-md p-1.5 text-ink-3 transition-colors hover:bg-surface-3 hover:text-ink-1"
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
          </button>
        )}
      </div>

      <NavSection title="Studio" items={PRIMARY_NAV} route={route} onNavigate={onNavigate} />
      <div className="space-y-0.5">
        <div className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-widest text-ink-3">
          Platform
        </div>
        {SECONDARY_NAV.map((item) =>
          item.route === 'settings' ? (
            <SettingsNav
              key={item.route}
              item={item}
              route={route}
              onNavigate={onNavigate}
              drivers={drivers}
              settingsBackend={settingsBackend}
            />
          ) : (
            <NavButton
              key={item.route}
              item={item}
              active={route === item.route}
              onClick={() => onNavigate(item.route)}
            />
          ),
        )}
      </div>

      <div className="mt-auto px-2.5 pt-2 text-[11px] leading-relaxed text-ink-3">
        <div className="rounded-lg border border-line bg-surface-2 px-2.5 py-2">
          <span className="font-medium text-ink-2">v0.1.0</span>
          <span className="ml-1">· console shell</span>
        </div>
      </div>
    </div>
  )
}

/** Drivers with a spec, for the Modules sub-menu (registry-driven, ADR-024). */
function useSettingsDrivers(): ReadonlyArray<{ backendId: string; label: string }> {
  // The KWS backend registry is populated at import time by driver modules;
  // a new driver with a spec automatically appears in the sub-menu.
  return React.useMemo(
    () =>
      getBackendRegistry()
        .filter((r) => r.spec?.params?.length)
        .map((r) => ({ backendId: r.id, label: r.label })),
    [],
  )
}

/** Global status indicator row (rendered in the top bar). */
function StatusIndicators({ status }: { status: ConsoleStatus }) {
  const micLabel =
    status.mic === 'active'
      ? 'Mic on'
      : status.mic === 'requesting'
        ? 'Requesting mic…'
        : status.mic === 'error'
          ? 'Mic error'
          : 'Mic idle'
  const modelLabel =
    status.model === 'ready'
      ? 'Model ready'
      : status.model === 'loading'
        ? 'Loading model…'
        : status.model === 'error'
          ? 'Model error'
          : 'No model'
  const detectionLabel =
    status.detection === 'running'
      ? 'Detecting'
      : status.detection === 'stopped'
        ? 'Detection stopped'
        : 'No detection'
  const workerLabel = status.worker === 'running' ? 'Worker on' : 'Worker idle'

  const Chip = ({ color, label, pulse }: { color: string; label: string; pulse?: boolean }) => (
    <span
      className={cn(
        'flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-2.5 py-1 text-[11px] font-medium text-ink-2',
      )}
      title={label}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', color, pulse && 'animate-pulse')} />
      {label}
    </span>
  )

  return (
    <div className="flex items-center gap-2 overflow-x-auto">
      <Chip
        color={status.mic === 'active' ? 'bg-success' : status.mic === 'error' ? 'bg-danger' : 'bg-slate-400'}
        label={micLabel}
        pulse={status.mic === 'requesting'}
      />
      <Chip
        color={status.model === 'ready' ? 'bg-success' : status.model === 'loading' ? 'bg-amber-400' : status.model === 'error' ? 'bg-danger' : 'bg-slate-400'}
        label={modelLabel}
        pulse={status.model === 'loading'}
      />
      <Chip
        color={status.detection === 'running' ? 'bg-emerald-500' : 'bg-slate-400'}
        label={detectionLabel}
        pulse={status.detection === 'running'}
      />
      {status.worker && (
        <Chip
          color={status.worker === 'running' ? 'bg-brand-500' : status.worker === 'error' ? 'bg-danger' : 'bg-slate-400'}
          label={workerLabel}
        />
      )}
    </div>
  )
}

/** Relative "updated …" caption for the recent-projects menu. */
function formatUpdated(ms: number): string {
  const diff = Date.now() - ms
  if (diff < 60_000) return 'updated just now'
  if (diff < 3_600_000) return `updated ${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `updated ${Math.floor(diff / 3_600_000)}h ago`
  return `updated ${new Date(ms).toLocaleDateString()}`
}

export function TopBar({
  title,
  route,
  status,
  onToggleSidebar,
  onNavigate,
}: {
  title: string
  route: ConsoleRoute
  status: ConsoleStatus
  onToggleSidebar: () => void
  onNavigate: (r: ConsoleRoute) => void
}) {
  const { projects, selectProject } = useProjects()
  const [createOpen, setCreateOpen] = React.useState(false)

  const recent = projects.slice(0, 5)

  const openProject = (id: string) => {
    selectProject(id)
    if (route !== 'workspace') onNavigate('workspace')
  }

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface-2/90 px-4 backdrop-blur">
      <button
        onClick={onToggleSidebar}
        className="rounded-md p-1.5 text-ink-3 hover:bg-surface-3 hover:text-ink-1 lg:hidden"
        aria-label="Toggle navigation"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </button>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <h1 className="truncate text-sm font-semibold text-ink-1">{title}</h1>
      </div>
      <div className="hidden items-center gap-2 sm:flex">
        {/* Recent projects (epic #53 P6, plan §7) — MRU, top 5. */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="flex items-center gap-1.5 rounded-lg border border-line bg-surface-3 px-2.5 py-1.5 text-sm font-medium text-ink-1 hover:bg-surface-4"
              aria-label="Recent projects"
            >
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-ink-3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 7h18M7 12h14M3 17h10" />
              </svg>
              Recent
              <svg viewBox="0 0 24 24" className="h-3 w-3 text-ink-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-60">
            {recent.length === 0 && (
              <div className="px-2.5 py-2 text-xs text-ink-3">No projects yet</div>
            )}
            {recent.map((p) => (
              <DropdownMenuItem key={p.id} onSelect={() => openProject(p.id)}>
                <span className="flex flex-col">
                  <span className="truncate text-sm text-ink-1">{p.name}</span>
                  <span className="text-[10px] text-ink-3">
                    {formatUpdated(p.updatedAtMs)}
                  </span>
                </span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setCreateOpen(true)}>
              <span className="text-brand-600">+ New project…</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <StatusIndicators status={status} />
      </div>
      <NewProjectDialog open={createOpen} onOpenChange={setCreateOpen} />
    </header>
  )
}
