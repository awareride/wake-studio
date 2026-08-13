/**
 * Session Console view (Phase 4).
 *
 * Renders the app-wide event log (from the log store) with level filtering,
 * plus a trigger-history table exportable as CSV. Wired into the shell nav
 * as a "Console" view.
 */

import * as React from 'react'
import type { LogEntry, LogLevel } from '../log'
import {
  getTriggerEntries,
  clearLog,
  triggersToCsv,
  downloadCsv,
} from '../log'
import { useLogEntries } from '../log'
import { Button, SegmentedControl, Tabs } from '@radix-ui/themes'
import { cn } from '../components/cn'
import { useToast } from '../components/toast'

const LEVEL_STYLES: Record<LogLevel, string> = {
  info: 'text-ink-2',
  warn: 'text-warning',
  error: 'text-danger',
}

const LEVEL_BADGE: Record<LogLevel, string> = {
  info: 'bg-surface-3 text-ink-3',
  warn: 'bg-amber-500/10 text-warning',
  error: 'bg-danger/10 text-danger',
}

function formatTime(at: number): string {
  const d = new Date(at)
  return d.toLocaleTimeString([], { hour12: false })
}

export function SessionConsoleView() {
  const { toast } = useToast()
  const entries = useLogEntries()
  const [levelFilter, setLevelFilter] = React.useState<'all' | LogLevel>('all')
  const [view, setView] = React.useState<'log' | 'triggers'>('log')

  const filtered = React.useMemo(
    () => (levelFilter === 'all' ? entries : entries.filter((e) => e.level === levelFilter)),
    [entries, levelFilter],
  )

  const triggers = React.useMemo(() => getTriggerEntries(), [entries])

  const handleClear = () => {
    clearLog()
    toast({ title: 'Session log cleared' })
  }

  const handleExportCsv = () => {
    const csv = triggersToCsv(triggers)
    downloadCsv(`wake-studio-triggers-${Date.now()}.csv`, csv)
    toast({
      title: 'Triggers exported',
      description: `${triggers.length} trigger(s) → CSV`,
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-ink-1">Session Console</h2>
          <p className="mt-1 text-sm text-ink-2">
            Live event log + wake-word trigger history. Events are captured
            app-wide (Phase 4).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={handleClear}
            variant="outline"
            size="2"
          >
            Clear
          </Button>
          <Button
            onClick={handleExportCsv}
            disabled={triggers.length === 0}
            size="2"
          >
            Export triggers CSV
          </Button>
        </div>
      </div>

      {/* Log / triggers sub-tabs (Radix Themes Tabs, primitives-backed). */}
      <Tabs.Root
        value={view}
        onValueChange={(v) => setView(v as 'log' | 'triggers')}
      >
        <Tabs.List size="1" className="w-fit">
          <Tabs.Trigger value="log">Event log</Tabs.Trigger>
          <Tabs.Trigger value="triggers">Triggers ({triggers.length})</Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="log" className="space-y-2 pt-3">
          {/* Level filter (Radix Themes SegmentedControl = ToggleGroup primitive). */}
          <SegmentedControl.Root
            size="1"
            value={levelFilter}
            onValueChange={(v) => setLevelFilter(v as LogLevel | 'all')}
          >
            {(['all', 'info', 'warn', 'error'] as const).map((l) => (
              <SegmentedControl.Item key={l} value={l}>
                {l === 'all' ? 'All' : l}
              </SegmentedControl.Item>
            ))}
          </SegmentedControl.Root>

          {/* Log list */}
          <div className="max-h-[60vh] overflow-y-auto rounded-xl border border-line bg-surface-2 font-mono text-xs">
            {filtered.length === 0 ? (
              <div className="p-6 text-center text-ink-3">No events yet.</div>
            ) : (
              <ul className="divide-y divide-line">
                {filtered.map((e) => (
                  <li key={e.id} className="flex items-start gap-3 px-3 py-1.5">
                    <span className="shrink-0 text-ink-3">{formatTime(e.at)}</span>
                    <span
                      className={cn(
                        'shrink-0 rounded px-1.5 py-px text-[10px] font-semibold uppercase',
                        LEVEL_BADGE[e.level],
                      )}
                    >
                      {e.level}
                    </span>
                    <span className="shrink-0 text-ink-3">{e.source}</span>
                    <span className={cn('min-w-0 flex-1 break-words', LEVEL_STYLES[e.level])}>
                      {e.message}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Tabs.Content>

        {/* Trigger history table */}
        <Tabs.Content value="triggers" className="pt-3">
          <div className="overflow-hidden rounded-xl border border-line bg-surface-2">
            {triggers.length === 0 ? (
              <div className="p-6 text-center text-sm text-ink-3">
                No triggers yet — run detection and say the wake word.
              </div>
            ) : (
              <table className="w-full text-left text-sm">
                <thead className="border-b border-line bg-surface-3 text-xs uppercase tracking-wide text-ink-3">
                  <tr>
                    <th className="px-3 py-2">Time</th>
                    <th className="px-3 py-2">Wake word</th>
                    <th className="px-3 py-2">Peak score</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {triggers.map((e) => (
                    <tr key={e.id} className="text-ink-2">
                      <td className="px-3 py-2 font-mono">{new Date(e.at).toLocaleString()}</td>
                      <td className="px-3 py-2 font-medium text-ink-1">{e.trigger!.word}</td>
                      <td className="px-3 py-2 font-mono">{e.trigger!.peakScore.toFixed(3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Tabs.Content>
      </Tabs.Root>
    </div>
  )
}

// Re-export for type convenience.
export type { LogEntry, LogLevel }
