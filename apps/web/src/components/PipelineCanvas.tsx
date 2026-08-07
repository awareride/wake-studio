/**
 * Pipeline canvas (epic #53 P4) - component selection + unified run control.
 *
 * Replaces the static 4-node canvas: the user picks which components run
 * (AFE master + AEC/BSS/NS stage toggles + KWS master), sees the source node,
 * and drives the whole pipeline with one Start/Stop button (the runner in
 * WorkspaceView orchestrates AFE → KWS).
 *
 * Keeps the "AEC → BSS → NS → KWS" subtitle (e2e-pinned).
 */

import * as React from 'react'
import type { ConsoleStatus } from '../status'
import { IconPlay, IconStop, IconSpinner } from './icons'
import { cn } from './cn'

export interface ComponentSelection {
  afe: boolean
  afeStages: { aec: boolean; bss: boolean; ns: boolean }
  kws: boolean
}

export interface PipelineRunState {
  phase: 'idle' | 'starting' | 'running' | 'stopping' | 'error'
  afeRunning: boolean
  kwsRunning: boolean
  kwsReady: boolean
  kwsLoading: boolean
  error: string | null
  /** Source label shown as the first node (e.g. "Mic · Built-in" / "Files (2)"). */
  sourceLabel: string
}

interface PipelineCanvasProps {
  selection: ComponentSelection
  onSelectionChange: (next: ComponentSelection) => void
  runState: PipelineRunState
  onStart: () => void
  onStop: () => void
  status: ConsoleStatus
  disabled?: boolean
}

const STAGES = [
  { id: 'aec', name: 'AEC', detail: 'Acoustic echo cancellation', color: '#818cf8' },
  { id: 'bss', name: 'BSS', detail: 'Blind source separation', color: '#a78bfa' },
  { id: 'ns', name: 'NS', detail: 'Noise suppression', color: '#38bdf8' },
  { id: 'kws', name: 'KWS', detail: 'Keyword spotting', color: '#34d399' },
] as const

export function PipelineCanvas({
  selection,
  onSelectionChange,
  runState,
  onStart,
  onStop,
  status,
  disabled,
}: PipelineCanvasProps) {
  const micOk = status.mic === 'active'
  const running = runState.phase === 'running' || runState.afeRunning
  const busy = runState.phase === 'starting' || runState.phase === 'stopping' || runState.kwsLoading

  const toggleAfe = () => {
    const next = { ...selection, afe: !selection.afe }
    onSelectionChange(next)
  }
  const toggleStage = (id: 'aec' | 'bss' | 'ns') => {
    onSelectionChange({
      ...selection,
      afeStages: { ...selection.afeStages, [id]: !selection.afeStages[id] },
    })
  }
  const toggleKws = () => {
    const next = { ...selection, kws: !selection.kws }
    onSelectionChange(next)
  }

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
          {!running ? (
            <button
              onClick={onStart}
              disabled={busy || disabled}
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
        </div>
      </div>

      {/* Component selection row */}
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-ink-3">
        <span className="font-medium uppercase tracking-widest">Components</span>
        {/* AFE master toggle */}
        <label className="flex items-center gap-1.5 rounded-lg border border-line bg-surface-3 px-2.5 py-1.5">
          <input
            type="checkbox"
            checked={selection.afe}
            disabled={disabled}
            onChange={toggleAfe}
            className="h-3.5 w-3.5 rounded accent-brand-500"
          />
          <span className={selection.afe ? 'text-ink-1' : 'text-ink-3'}>AFE</span>
        </label>
        {/* AFE stage toggles (visible when AFE on) */}
        {selection.afe && (
          <div className="flex items-center gap-1.5">
            {(['aec', 'bss', 'ns'] as const).map((s) => (
              <label
                key={s}
                className="flex items-center gap-1 rounded-lg border border-line bg-surface-3 px-2 py-1.5"
              >
                <input
                  type="checkbox"
                  checked={selection.afeStages[s]}
                  disabled={disabled}
                  onChange={() => toggleStage(s)}
                  className="h-3.5 w-3.5 rounded accent-brand-500"
                />
                <span className="uppercase">{s}</span>
              </label>
            ))}
          </div>
        )}
        {/* KWS master toggle */}
        <label className="flex items-center gap-1.5 rounded-lg border border-line bg-surface-3 px-2.5 py-1.5">
          <input
            type="checkbox"
            checked={selection.kws}
            disabled={disabled}
            onChange={toggleKws}
            className="h-3.5 w-3.5 rounded accent-brand-500"
          />
          <span className={selection.kws ? 'text-ink-1' : 'text-ink-3'}>KWS</span>
        </label>
        {runState.kwsLoading && <span className="text-amber-400">loading models…</span>}
      </div>

      {/* Flow diagram */}
      <div className="flex flex-wrap items-center gap-1">
        <div className="flex flex-col items-center gap-1">
          <div className="flex h-10 w-14 items-center justify-center rounded-lg border border-line bg-surface-3 px-1 text-[9px] font-medium text-ink-2">
            <span className="truncate">{runState.sourceLabel}</span>
          </div>
          <span className="text-[10px] text-ink-3">Source</span>
        </div>
        <div className="mx-0.5 mb-4 h-0.5 w-4 rounded bg-line-2" />

        {STAGES.map((stage, i) => {
          const enabled =
            stage.id === 'kws'
              ? selection.kws
              : selection.afe && selection.afeStages[stage.id as 'aec' | 'bss' | 'ns']
          const stageRunning =
            stage.id === 'kws' ? runState.kwsRunning : selection.afe && runState.afeRunning
          return (
            <React.Fragment key={stage.id}>
              <div className="flex flex-col items-center gap-1">
                <div
                  className={cn(
                    'flex h-10 w-14 items-center justify-center rounded-lg border text-xs font-bold uppercase tracking-wide',
                    !enabled
                      ? 'border-line bg-surface-3 text-ink-3 opacity-50'
                      : stageRunning
                        ? 'border-brand-500/40 bg-brand-500/10'
                        : 'border-line bg-surface-3 text-ink-2',
                  )}
                  style={enabled ? { color: stage.color } : undefined}
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
                    stageRunning ? 'bg-brand-400' : 'bg-line-2',
                  )}
                />
              )}
            </React.Fragment>
          )
        })}
      </div>

      {!micOk && runState.afeRunning && (
        <div className="mt-3 text-xs text-warning">Microphone not active — check permissions.</div>
      )}
      {runState.error && (
        <div className="mt-3 text-xs text-danger">{runState.error}</div>
      )}
    </div>
  )
}
