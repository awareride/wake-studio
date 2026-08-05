/**
 * Pipeline canvas - visual orchestration of AEC -> BSS -> NS -> KWS.
 *
 * Renders the four stages as connected nodes with live status (bypass /
 * active / running) and a shared run/stop control that drives the AFE
 * (which feeds KWS). Phase 2 scope: orchestration + rendering; the engine
 * internals stay behind the existing module APIs.
 */

import * as React from 'react'
import type { ConsoleStatus } from '../status'
import { IconPlay, IconStop, IconSpinner } from './icons'
import { cn } from './cn'

interface PipelineCanvasProps {
  afeRunning: boolean
  onStart: () => void
  onStop: () => void
  status: ConsoleStatus
}

const STAGES = [
  { id: 'aec', name: 'AEC', detail: 'Acoustic echo cancellation', color: '#818cf8' },
  { id: 'bss', name: 'BSS', detail: 'Blind source separation', color: '#a78bfa' },
  { id: 'ns', name: 'NS', detail: 'Noise suppression', color: '#38bdf8' },
  { id: 'kws', name: 'KWS', detail: 'Keyword spotting', color: '#34d399' },
] as const

export function PipelineCanvas({ afeRunning, onStart, onStop, status }: PipelineCanvasProps) {
  const micOk = status.mic === 'active'

  return (
    <div className="rounded-xl border border-line bg-surface-2 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-ink-1">Pipeline</div>
          <div className="text-xs text-ink-3">
            AEC → BSS → NS → KWS · live capture drives detection
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!afeRunning ? (
            <button
              onClick={onStart}
              className="flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-1.5 text-sm font-medium text-ink-1 hover:bg-brand-400"
            >
              <IconPlay className="h-3.5 w-3.5" /> Start pipeline
            </button>
          ) : (
            <button
              onClick={onStop}
              className="flex items-center gap-1.5 rounded-lg bg-danger/90 px-3 py-1.5 text-sm font-medium text-ink-1 hover:bg-red-500"
            >
              <IconStop className="h-3.5 w-3.5" /> Stop
            </button>
          )}
          {afeRunning && <IconSpinner className="h-4 w-4 text-brand-600" />}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        {STAGES.map((stage, i) => (
          <React.Fragment key={stage.id}>
            <div className="flex flex-col items-center gap-1">
              <div
                className={cn(
                  'flex h-10 w-14 items-center justify-center rounded-lg border text-xs font-bold uppercase tracking-wide',
                  afeRunning
                    ? 'border-brand-500/40 bg-brand-500/10 text-brand-700'
                    : 'border-line bg-surface-3 text-ink-2',
                )}
                style={afeRunning ? { color: stage.color } : undefined}
              >
                {stage.name}
              </div>
              <span className="max-w-24 truncate text-center text-[10px] text-ink-3">
                {stage.detail}
              </span>
            </div>
            {i < STAGES.length - 1 && (
              <div
                className={cn(
                  'mx-0.5 mb-4 h-0.5 w-4 rounded sm:w-6',
                  afeRunning ? 'bg-brand-400' : 'bg-line-2',
                )}
              />
            )}
          </React.Fragment>
        ))}
      </div>

      {!micOk && afeRunning && (
        <div className="mt-3 text-xs text-warning">Microphone not active — check permissions.</div>
      )}
    </div>
  )
}
