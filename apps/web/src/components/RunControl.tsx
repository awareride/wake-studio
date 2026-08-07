/**
 * Run control (epic #53 UX).
 *
 * Primary Start/Stop as icon-only circular actions (the single run control).
 * The KWS enable toggle moved onto the KWS stage card.
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
  runState: PipelineRunState
  onStart: () => void
  onStop: () => void
}

export function RunControl({ runState, onStart, onStop }: Props) {
  const running = runState.phase === 'running' || runState.afeRunning
  const busy = runState.phase === 'starting' || runState.phase === 'stopping' || runState.kwsLoading

  return (
    <div className="flex items-center gap-2">
      {!running ? (
        <button
          onClick={onStart}
          disabled={busy}
          aria-label="Start pipeline"
          title="Start pipeline"
          className={cn(
            'flex h-11 w-11 items-center justify-center rounded-full bg-brand-500 text-ink-1 shadow-lg shadow-brand-500/30 transition hover:bg-brand-400 disabled:opacity-50',
            busy && 'cursor-not-allowed',
          )}
        >
          <IconPlay className="h-5 w-5" />
        </button>
      ) : (
        <button
          onClick={onStop}
          disabled={busy}
          aria-label="Stop pipeline"
          title="Stop pipeline"
          className={cn(
            'flex h-11 w-11 items-center justify-center rounded-full bg-danger/90 text-ink-1 shadow-lg shadow-danger/25 transition hover:bg-red-500 disabled:opacity-50',
            busy && 'cursor-not-allowed',
          )}
        >
          <IconStop className="h-5 w-5" />
        </button>
      )}
      {busy && <IconSpinner className="h-5 w-5 text-brand-600" />}
      {runState.kwsLoading && (
        <span className="text-xs text-amber-400">loading models…</span>
      )}
    </div>
  )
}
