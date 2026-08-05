/**
 * Session log + trigger history (Phase 4).
 *
 * A lightweight, app-wide event log replacing scattered console.log/error
 * calls. Panels and engines publish events here; the Session Console view
 * renders them and exports triggers as CSV.
 *
 * No external deps. Ring-buffered (cap) so the console stays bounded.
 */

import * as React from 'react'
import type { KWSTriggerEvent } from './kws'

export type LogLevel = 'info' | 'warn' | 'error'

export interface LogEntry {
  id: number
  at: number
  level: LogLevel
  source: string
  message: string
  /** Optional structured payload (e.g. a trigger). */
  trigger?: KWSTriggerEvent
}

export const LOG_CAP = 500

let nextId = 1

// ---------------------------------------------------------------------------
// Store (module-level, shared across views).
// ---------------------------------------------------------------------------

interface LogStore {
  entries: LogEntry[]
  /** Push an entry; returns its id. */
  push: (entry: Omit<LogEntry, 'id' | 'at'>) => number
  clear: () => void
}

const store: LogStore = {
  entries: [],
  push(entry) {
    const e: LogEntry = { id: nextId++, at: Date.now(), ...entry }
    store.entries.push(e)
    if (store.entries.length > LOG_CAP) {
      store.entries.splice(0, store.entries.length - LOG_CAP)
    }
    return e.id
  },
  clear() {
    store.entries = []
  },
}

// ---------------------------------------------------------------------------
// React context so the console view re-renders on new entries.
// ---------------------------------------------------------------------------

const LogContext = React.createContext<LogEntry[]>([])

/** Subscribe to the log. Re-renders the consumer on new entries. */
export function LogProvider({ children }: { children: React.ReactNode }) {
  const [entries, setEntries] = React.useState<LogEntry[]>(store.entries)

  React.useEffect(() => {
    // Poll the module store; simplest no-dep approach for a small app.
    const id = setInterval(() => setEntries([...store.entries]), 500)
    return () => clearInterval(id)
  }, [])

  return <LogContext.Provider value={entries}>{children}</LogContext.Provider>
}

export function useLogEntries(): LogEntry[] {
  return React.useContext(LogContext)
}

// ---------------------------------------------------------------------------
// Imperative publish API (no hook needed for non-React call sites).
// ---------------------------------------------------------------------------

/** Log an info event. */
export function logInfo(source: string, message: string): void {
  store.push({ level: 'info', source, message })
}

/** Log a warning. */
export function logWarn(source: string, message: string): void {
  store.push({ level: 'warn', source, message })
}

/** Log an error. */
export function logError(source: string, message: string): void {
  store.push({ level: 'error', source, message })
}

/** Log a KWS trigger event (also recorded for CSV export). */
export function logTrigger(source: string, trigger: KWSTriggerEvent): void {
  store.push({
    level: 'info',
    source,
    message: `Trigger: ${trigger.word} (${trigger.peakScore.toFixed(3)})`,
    trigger,
  })
}

/** Current entries (non-React reads, e.g. CSV export). */
export function getLogEntries(): LogEntry[] {
  return [...store.entries]
}

/** Clear the log. */
export function clearLog(): void {
  store.clear()
}

/** Trigger-only entries (for the history table / CSV). */
export function getTriggerEntries(): LogEntry[] {
  return store.entries.filter((e) => e.trigger)
}

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------

function escapeCsv(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

/** Build a CSV string of trigger history. */
export function triggersToCsv(entries: LogEntry[]): string {
  const header = ['time', 'word', 'peak_score'].join(',')
  const rows = entries.map((e) => {
    const t = e.trigger!
    const time = new Date(e.at).toISOString()
    return [escapeCsv(time), escapeCsv(t.word), t.peakScore.toFixed(3)].join(',')
  })
  return [header, ...rows].join('\n')
}

/** Download a CSV file client-side. */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
