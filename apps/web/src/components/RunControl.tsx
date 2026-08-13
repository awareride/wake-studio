/**
 * Run control (epic #53 UX).
 *
 * Primary Start/Stop as icon-only circular actions (the single run control).
 * The KWS enable toggle moved onto the KWS stage card.
 */

import { IconPlay, IconStop, IconSpinner } from './icons'
import { IconButton } from '@radix-ui/themes'
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
        <IconButton
          onClick={onStart}
          disabled={busy}
          aria-label="Start pipeline"
          title="Start pipeline"
          size="4"
          radius="full"
          className={cn('shadow-lg', busy && 'cursor-not-allowed')}
        >
          <IconPlay className="h-5 w-5" />
        </IconButton>
      ) : (
        <IconButton
          onClick={onStop}
          disabled={busy}
          aria-label="Stop pipeline"
          title="Stop pipeline"
          size="4"
          radius="full"
          variant="solid"
          color="red"
          className={cn('shadow-lg', busy && 'cursor-not-allowed')}
        >
          <IconStop className="h-5 w-5" />
        </IconButton>
      )}
      {busy && <IconSpinner className="h-5 w-5 text-brand-11" />}
      {runState.kwsLoading && (
        <span className="text-xs text-amber-400">loading models…</span>
      )}
    </div>
  )
}
