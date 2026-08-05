/**
 * Global console status - single source of truth for the shell status bar.
 *
 * Panels publish their state here (mic, model, worker, detection) and the
 * top bar renders it. Lifted out of individual panels so the shell is the
 * orchestrator (Phase 1), and the panels become consumers (Phase 2).
 */

import * as React from 'react'

export type MicState = 'idle' | 'requesting' | 'active' | 'error'
export type ModelLoadState = 'idle' | 'loading' | 'ready' | 'error'

export interface ConsoleStatus {
  mic: MicState
  model: ModelLoadState
  worker: 'idle' | 'running' | 'error' | null
  detection: 'stopped' | 'running' | null
}

const DEFAULT_STATUS: ConsoleStatus = {
  mic: 'idle',
  model: 'idle',
  worker: null,
  detection: null,
}

interface ConsoleStatusContextValue {
  status: ConsoleStatus
  setStatus: (patch: Partial<ConsoleStatus>) => void
}

const ConsoleStatusContext = React.createContext<ConsoleStatusContextValue | null>(
  null,
)

export function ConsoleStatusProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatusState] = React.useState<ConsoleStatus>(DEFAULT_STATUS)

  const setStatus = React.useCallback((patch: Partial<ConsoleStatus>) => {
    setStatusState((prev) => ({ ...prev, ...patch }))
  }, [])

  return (
    <ConsoleStatusContext.Provider value={{ status, setStatus }}>
      {children}
    </ConsoleStatusContext.Provider>
  )
}

export function useConsoleStatus(): ConsoleStatusContextValue {
  const ctx = React.useContext(ConsoleStatusContext)
  if (!ctx) {
    throw new Error('useConsoleStatus must be used within ConsoleStatusProvider')
  }
  return ctx
}
