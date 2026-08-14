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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from './ui'
import { Button, IconButton } from '@radix-ui/themes'
import {
  ChevronRightIcon,
  Cross2Icon,
  HamburgerMenuIcon,
  StopIcon,
  SunIcon,
  MoonIcon,
  LaptopIcon,
  CheckIcon,
} from '@radix-ui/react-icons'
import { useAppSettings } from '../settings'
import type { ThemeMode } from '../settings'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui'
import { PRIMARY_NAV, SECONDARY_NAV, isSettingsRoute, type NavItem } from './shell-nav'
import { useLiveAfe, useLiveKws } from '../workspace/live'
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
        <Button
          onClick={onClick}
          aria-current={active ? 'page' : undefined}
          variant={active ? 'soft' : 'ghost'}
          size="2"
          className={cn('nav-row w-full justify-start', !active && 'text-ink-2')}
        >
          <Icon className="h-[18px] w-[18px] shrink-0" />
          <span className="flex-1 truncate text-left">{item.label}</span>
          {item.badge && (
            <span className="rounded bg-surface-4 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-3">
              {item.badge}
            </span>
          )}
        </Button>
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
      <Button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={`Settings menu ${open ? 'collapsed' : 'expanded'}`}
        variant="ghost"
        size="2"
        className="nav-row w-full justify-start text-ink-2"
      >
        <Icon className="h-[18px] w-[18px] shrink-0" />
        <span className="flex-1 truncate text-left">{item.label}</span>
        <ChevronRightIcon
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-ink-3 transition-transform',
            open && 'rotate-90',
          )}
        />
      </Button>

      {open && (
        <div className="ml-3 mt-0.5 space-y-0.5 border-l border-line pl-2">          {sections.map((child) => {
            const childActive = activeSection === settingsSectionOf(child.route)
            return (
              <Button
                key={child.route}
                onClick={() => onNavigate(child.route)}
                aria-current={childActive ? 'page' : undefined}
                variant={childActive ? 'soft' : 'ghost'}
                size="1"
                className={cn('nav-row w-full justify-start', !childActive && 'text-ink-3')}
              >
                <span className="flex-1 truncate text-left">{child.label}</span>
              </Button>
            )
          })}

          {/* Drivers: Settings -> driver (keeps focus on the clicked one). */}
          {drivers.map((d) => {
            const active = driversActive && d.backendId === settingsBackend
            return (
              <Button
                key={d.backendId}
                onClick={() => {
                  window.location.hash = settingsHash('modules', d.backendId)
                }}
                aria-current={active ? 'page' : undefined}
                variant={active ? 'soft' : 'ghost'}
                size="1"
                className={cn('nav-row w-full justify-start', !active && 'text-ink-3')}
              >
                <span className="flex-1 truncate text-left">{d.label}</span>
              </Button>
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
          <IconButton
            onClick={onClose}
            aria-label="Close navigation"
            variant="ghost"
            size="1"
            className="text-ink-3"
          >
            <Cross2Icon className="h-4 w-4" />
          </IconButton>
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

/**
 * Theme mode switch — top-bar dropdown (Light / Dark / System, issue #142).
 * Writes the same persisted setting as Settings -> General -> Theme, so both
 * stay in sync; System follows the OS preference live.
 */
const THEME_OPTIONS: ReadonlyArray<{ mode: ThemeMode; label: string; Icon: typeof SunIcon }> = [
  { mode: 'light', label: 'Light', Icon: SunIcon },
  { mode: 'dark', label: 'Dark', Icon: MoonIcon },
  { mode: 'system', label: 'System', Icon: LaptopIcon },
]

function ThemeSwitchButton() {
  const { platform, set } = useAppSettings()
  const mode: ThemeMode = platform.theme ?? 'light'
  const current = THEME_OPTIONS.find((o) => o.mode === mode) ?? THEME_OPTIONS[0]
  const CurrentIcon = current.Icon

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          variant="ghost"
          size="2"
          aria-label={`Theme: ${current.label}`}
          title="Theme"
          className="text-ink-3"
        >
          <CurrentIcon className="h-4 w-4" />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        {THEME_OPTIONS.map(({ mode: m, label, Icon }) => (
          <DropdownMenuItem key={m} onSelect={() => set('theme', m)}>
            <span className="flex flex-1 items-center gap-2">
              <Icon className="h-3.5 w-3.5 text-ink-3" />
              <span className="text-sm">{label}</span>
            </span>
            {mode === m && <CheckIcon className="h-3.5 w-3.5 text-brand-11" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
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

export function TopBar({
  title,
  onToggleSidebar,
}: {
  title: string
  onToggleSidebar: () => void
}) {
  const [barOpen, setBarOpen] = React.useState(true)

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface-2/90 px-4 backdrop-blur">
      <IconButton
        onClick={onToggleSidebar}
        variant="ghost"
        size="2"
        className="text-ink-3 lg:hidden"
        aria-label="Toggle navigation"
      >
        <HamburgerMenuIcon className="h-5 w-5" />
      </IconButton>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <h1 className="truncate text-sm font-semibold text-ink-1">{title}</h1>
      </div>
      <div className="flex items-center gap-2">
        <ThemeSwitchButton />
        <MiniPipelineBar open={barOpen} onToggle={() => setBarOpen((v) => !v)} />
      </div>
    </header>
  )
}

/**
 * Mini pipeline bar (epic #53 UX): shows only while the pipeline is running.
 * A pill containing the Source → … → KWS chain, a wake indicator (light +
 * 'Wake!' badge when the score clears the threshold — no numeric readout),
 * a Stop button and a minimize control. Minimizing collapses the pill to a
 * small circle (animating toward the right) whose color mirrors the wake
 * indicator; clicking the circle expands it back leftward.
 */
function MiniPipelineBar({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const { running, bypass, stopPipeline } = useLiveAfe()
  const { kwsRunning, lastScore, threshold } = useLiveKws()

  // Edge-triggered wake flash: the indicator lights for ~1.5 s when the
  // score first crosses the threshold, then returns to gray. The timer lives
  // in a ref so score oscillation around the threshold can't clear it (which
  // previously left the indicator stuck green); a cooldown ignores re-crosses
  // within 2 s of the last flash.
  const woken = running && kwsRunning && lastScore >= threshold
  const [wakeFlash, setWakeFlash] = React.useState(false)
  const prevWokenRef = React.useRef(false)
  const lastFlashAtRef = React.useRef(0)
  const flashTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  React.useEffect(() => {
    const crossed = woken && !prevWokenRef.current
    prevWokenRef.current = woken
    if (!crossed) return
    const now = Date.now()
    if (now - lastFlashAtRef.current < 2000) return
    lastFlashAtRef.current = now
    setWakeFlash(true)
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
    flashTimerRef.current = setTimeout(() => {
      setWakeFlash(false)
      flashTimerRef.current = null
    }, 1500)
  }, [woken])

  // Clear a pending flash timer on unmount.
  React.useEffect(() => {
    return () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
    }
  }, [])

  if (!running) return null

  const stages = [
    { label: 'Source', active: true },
    { label: 'AEC', active: !bypass.aec },
    { label: 'BSS', active: !bypass.bss },
    { label: 'NS', active: !bypass.ns },
    { label: 'KWS', active: kwsRunning },
  ]

  // The wake color applies to both the expanded dot and the minimized circle
  // — brief green pulse on a wake event, gray otherwise.
  const dotClass = wakeFlash
    ? 'animate-pulse bg-emerald-400'
    : 'bg-slate-500'

  return (
    <div
      className={cn(
        'relative flex h-8 items-center overflow-hidden rounded-full border border-line bg-surface-2 transition-all duration-300',
        open ? 'max-w-96' : 'max-w-8',
      )}
    >
      {/* Expanded content — fades + clips while the pill collapses. */}
      <div
        className={cn(
          'flex min-w-0 items-center gap-2 whitespace-nowrap pl-3 pr-1 transition-opacity duration-200',
          open ? 'visible opacity-100' : 'pointer-events-none invisible opacity-0',
        )}
      >
        <span className={cn('h-2 w-2 shrink-0 rounded-full', dotClass)} />
        {wakeFlash && (
          <span className="animate-pulse rounded bg-emerald-500/25 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-emerald-300">
            Wake!
          </span>
        )}
        {stages.map((s, i) => (
          <React.Fragment key={s.label}>
            {i > 0 && <span className="text-[9px] text-ink-3">→</span>}
            <span
              className={cn(
                'text-[10px] font-medium uppercase tracking-wide',
                s.active ? 'text-emerald-300' : 'text-ink-3',
              )}
            >
              {s.label}
            </span>
          </React.Fragment>
        ))}
        <span className="mx-1 h-4 w-px shrink-0 bg-line-2" />
        <IconButton
          onClick={stopPipeline}
          aria-label="Stop pipeline"
          variant="ghost"
          color="red"
          size="1"
          className="shrink-0"
        >
          <StopIcon className="h-3 w-3" />
        </IconButton>
        <IconButton
          onClick={onToggle}
          aria-label="Minimize pipeline status"
          variant="ghost"
          size="1"
          className="shrink-0 text-ink-3"
        >
          <ChevronRightIcon className="h-3 w-3" />
        </IconButton>
      </div>

      {/* Minimized: the circle itself is colored by the wake indicator.
          Absolutely centered so the (layout-keeping, width-driving) invisible
          expanded content can't push it out of the 32px pill. */}
      {!open && (
        <button
          onClick={onToggle}
          aria-label="Show pipeline status"
          className={cn(
            'absolute inset-0 m-auto h-7 w-7 rounded-full transition-colors',
            dotClass,
          )}
        />
      )}
    </div>
  )
}
