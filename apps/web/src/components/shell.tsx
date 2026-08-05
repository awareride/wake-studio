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

import type { ConsoleRoute } from '../router'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui'
import { PRIMARY_NAV, SECONDARY_NAV, type NavItem } from './shell-nav'
import type { ConsoleStatus } from '../status'
import { cn } from './cn'

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
}: {
  route: ConsoleRoute
  onNavigate: (r: ConsoleRoute) => void
}) {
  return (
    <div className="flex h-full w-full flex-col gap-1 overflow-y-auto p-3">
      <div className="mb-2 flex items-center gap-2 px-1.5">
        <Logo />
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-semibold tracking-tight text-ink-1">
            WakeStudio
          </span>
          <span className="text-[11px] text-ink-3">on-device KWS studio</span>
        </div>
      </div>

      <NavSection title="Studio" items={PRIMARY_NAV} route={route} onNavigate={onNavigate} />
      <NavSection title="Platform" items={SECONDARY_NAV} route={route} onNavigate={onNavigate} />

      <div className="mt-auto px-2.5 pt-2 text-[11px] leading-relaxed text-ink-3">
        <div className="rounded-lg border border-line bg-surface-2 px-2.5 py-2">
          <span className="font-medium text-ink-2">v0.1.0</span>
          <span className="ml-1">· console shell</span>
        </div>
      </div>
    </div>
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

export function TopBar({
  title,
  status,
  onToggleSidebar,
}: {
  title: string
  status: ConsoleStatus
  onToggleSidebar: () => void
}) {
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
        <StatusIndicators status={status} />
      </div>
    </header>
  )
}
