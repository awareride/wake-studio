/**
 * Run control (epic #53 UX overhaul).
 *
 * The minimal pipeline control row: unified Start/Stop (drives the workspace
 * runner) + the KWS component toggle that gates the KWS config tab. The old
 * PipelineCanvas's flow diagram / component matrix were redundant with the
 * Source → … → KWS config tabs and the per-module bypass controls.
 */

import { IconPlay, IconStop, IconSpinner } from './icons'
import { cn } from './cn'

export interface PipelineRunState {
  phase: 'idle' | 'starting' | 'running' | 'stopping' | 'error'
  afeRunning: boolean
  kwsRunning: boolean
  kwsReady: boolean
  kwsLoading: boolean
  error: string | null
  /** Source label (first flow node) — kept for the dashboard. */
  sourceLabel: string
}

interface Props {
  kwsEnabled: boolean
  onToggleKws: (v: boolean) => void
  runState: PipelineRunState
  onStart: () => void
  onStop: () => void
}

export function RunControl({ kwsEnabled, onToggleKws, runState, onStart, onStop }: Props) {
  const running = runState.phase === 'running' || runState.afeRunning
  const busy = runState.phase === 'starting' || runState.phase === 'stopping' || runState.kwsLoading

  return (
    <div className="flex flex-wrap items-center gap-3">
      {!running ? (
        <button
          onClick={onStart}
          disabled={busy}
          className="flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-1.5 text-sm font-medium text-ink-1 hover:bg-brand-400 disabled:opacity-50"
        >
          <IconPlay className="h-3.5 w-3.5" /> Start pipeline
        </button>
      ) : (
        <button
          onClick={onStop}
          disabled={busy}
          className="flex items-center gap-1.5 rounded-lg bg-danger/90 px-3 py-1.5 text-sm font-medium text-ink-1 hover:bg-red-500 disabled:opacity-50"
        >
          <IconStop className="h-3.5 w-3.5" /> Stop
        </button>
      )}
      {busy && <IconSpinner className="h-4 w-4 text-brand-600" />}

      {/* KWS component toggle — gates the KWS config tab. */}
      <label className="flex items-center gap-1.5 rounded-lg border border-line bg-surface-3 px-2.5 py-1.5 text-sm">
        <input
          type="checkbox"
          checked={kwsEnabled}
          onChange={(e) => onToggleKws(e.target.checked)}
          className="h-3.5 w-3.5 rounded accent-brand-500"
        />
        <span className={cn(kwsEnabled ? 'text-ink-1' : 'text-ink-3')}>KWS</span>
      </label>
      {runState.kwsLoading && <span className="text-xs text-amber-400">loading models…</span>}
    </div>
  )
}
