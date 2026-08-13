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
          <button
            onClick={handleClear}
            className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink-2 hover:bg-surface-3"
          >
            Clear
          </button>
          <button
            onClick={handleExportCsv}
            disabled={triggers.length === 0}
            className="rounded-lg bg-brand-9 px-3 py-1.5 text-sm font-medium text-ink-1 hover:bg-brand-10 disabled:opacity-40"
          >
            Export triggers CSV
          </button>
        </div>
      </div>

      {/* Log / triggers sub-tabs */}
      <div className="inline-flex rounded-lg border border-line bg-surface-2 p-1">
        {(['log', 'triggers'] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={cn(
              'rounded-md px-3 py-1 text-sm font-medium',
              view === v ? 'bg-brand-9/10 text-brand-11' : 'text-ink-3 hover:text-ink-1',
            )}
          >
            {v === 'log' ? 'Event log' : `Triggers (${triggers.length})`}
          </button>
        ))}
      </div>

      {view === 'log' ? (
        <>
          {/* Level filter */}
          <div className="flex gap-1">
            {(['all', 'info', 'warn', 'error'] as const).map((l) => (
              <button
                key={l}
                onClick={() => setLevelFilter(l)}
                className={cn(
                  'rounded-full px-2.5 py-1 text-xs font-medium',
                  levelFilter === l
                    ? 'bg-surface-4 text-ink-1'
                    : 'text-ink-3 hover:text-ink-1',
                )}
              >
                {l === 'all' ? 'All' : l}
              </button>
            ))}
          </div>

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
        </>
      ) : (
        /* Trigger history table */
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
      )}
    </div>
  )
}

// Re-export for type convenience.
export type { LogEntry, LogLevel }
