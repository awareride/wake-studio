/**
 * Unified pipeline runner (epic #53 P4).
 *
 * Single owner of the Start/Stop lifecycle, replacing the old split controls
 * (PipelineCanvas drove only the AFE; KWS had its own Start detection).
 *
 * Order on Start:
 *   1. AFE start (via the AFE panel's commandRef, which owns source +
 *      bypass config + viz subscriptions).
 *   2. If KWS is enabled AND preload-on-start is ON: load models if not
 *      ready, then start detection automatically (no separate button).
 *   3. If KWS is enabled but preload is OFF: AFE runs; KWS stays idle until
 *      the user manually Loads in the panel.
 *
 * Order on Stop: KWS stop → AFE stop.
 *
 * Also publishes the global console status truthfully: mic active only while
 * AFE runs; worker running only when a KWS worker is loaded; detection
 * running only when KWS is enabled AND running; model loading/ready/error
 * from the KWS load state.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useConsoleStatus } from '../status'
import { runPipelineStart, runPipelineStop } from './pipelineOrchestrator'

/** Commands the runner drives on the panels (exposed via commandRef). */
export interface PanelCommands {
  start: () => Promise<void> | void
  stop: () => void
  /** KWS-specific: load models. */
  load?: () => Promise<void>
  /** KWS-specific: read current engine state. */
  getState?: () => { status: string; running: boolean; isFewShot: boolean }
}

export type PipelinePhase =
  | 'idle'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'error'

export interface PipelineRunnerState {
  phase: PipelinePhase
  /** Whether the AFE pipeline is currently running. */
  afeRunning: boolean
  /** Whether KWS detection is running. */
  kwsRunning: boolean
  /** Whether KWS models are loaded (ready). */
  kwsReady: boolean
  /** Last start error message (cleared on next start). */
  error: string | null
  /** True while the runner is auto-loading KWS models on Start. */
  kwsLoading: boolean
}

interface Options {
  /** Whether KWS is enabled in the component selection. */
  kwsEnabled: boolean
  /** Whether to auto-load KWS models on Start (confirmed decision §11.2,
   *  default true). */
  kwsPreloadOnStart: boolean
}

export function usePipelineRunner(
  afeCommands: React.MutableRefObject<PanelCommands | null> | null,
  kwsCommands: React.MutableRefObject<PanelCommands | null> | null,
  { kwsEnabled, kwsPreloadOnStart }: Options,
) {
  const { setStatus } = useConsoleStatus()
  const [state, setState] = useState<PipelineRunnerState>({
    phase: 'idle',
    afeRunning: false,
    kwsRunning: false,
    kwsReady: false,
    error: null,
    kwsLoading: false,
  })

  // Keep latest flags in refs so the async Start can read them without
  // stale closures.
  const flagsRef = useRef({ kwsEnabled, kwsPreloadOnStart })
  flagsRef.current = { kwsEnabled, kwsPreloadOnStart }

  const start = useCallback(async () => {
    setState((s) => ({ ...s, error: null, phase: 'starting' }))

    const result = await runPipelineStart(
      afeCommands?.current,
      kwsCommands?.current,
      flagsRef.current,
    )
    if (!result.ok) {
      setState((s) => ({ ...s, phase: 'error', error: result.error ?? 'Start failed.' }))
      return
    }
    setState((s) => ({
      ...s,
      phase: 'running',
      afeRunning: true,
      kwsLoading: false,
      kwsReady: flagsRef.current.kwsEnabled
        ? (kwsCommands?.current?.getState?.()?.status === 'ready' ||
          kwsCommands?.current?.getState?.()?.status === 'running' ||
          result.kwsLoaded === true)
        : false,
      kwsRunning: flagsRef.current.kwsEnabled
        ? (kwsCommands?.current?.getState?.()?.running ?? false)
        : false,
    }))
  }, [afeCommands, kwsCommands])

  const stop = useCallback(() => {
    setState((s) => ({ ...s, phase: 'stopping' }))
    runPipelineStop(afeCommands?.current, kwsCommands?.current)
    setState({
      phase: 'idle',
      afeRunning: false,
      kwsRunning: false,
      kwsReady: false,
      error: null,
      kwsLoading: false,
    })
  }, [afeCommands, kwsCommands])

  // Poll KWS state (the runner doesn't own the KWS panel's state; it reads
  // it via getState on a light interval so the canvas + status bar stay
  // truthful even when the user stops detection from the KWS panel).
  useEffect(() => {
    const id = setInterval(() => {
      const s = kwsCommands?.current?.getState?.()
      if (!s) return
      setState((prev) => ({
        ...prev,
        kwsRunning: s.running,
        kwsReady: s.status === 'ready' || s.status === 'running',
      }))
    }, 250)
    return () => clearInterval(id)
  }, [kwsCommands])

  // Publish global console status.
  useEffect(() => {
    setStatus({
      mic: state.afeRunning ? 'active' : 'idle',
      worker: state.kwsReady ? 'running' : null,
      detection: state.kwsRunning ? 'running' : 'stopped',
      model: state.kwsLoading
        ? 'loading'
        : state.kwsReady
          ? 'ready'
          : 'idle',
    })
  }, [state.afeRunning, state.kwsReady, state.kwsRunning, state.kwsLoading, setStatus])

  return { state, start, stop }
}
