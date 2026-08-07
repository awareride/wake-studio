/**
 * Workspace live-runtime state (epic #53 P7, plan §8).
 *
 * The Phase 2 preview (overview, stage cards, score curve) lives in its own
 * container, separate from the Phase 1 config panels. The engine-level live
 * data is produced inside the config panels (AFE onFrame / latency, KWS
 * engine.onScore) and consumed by the preview — this module bridges the two
 * sides so the panels stay the data producers and the preview stays pure.
 *
 * Two providers keep re-render scope tight: AFE frame data updates at 30 fps
 * (only AFE config + preview consume it); the KWS history is a ref (no
 * re-renders) shared with the score-curve canvas.
 */

import * as React from 'react'
import type { StageFrameData } from '@wake-studio/module-afe-graph'
import type { KWSScoreSample } from '@wake-studio/module-kws-engine'

export type AfeStageId = 'aec' | 'bss' | 'ns'

// ---------------------------------------------------------------------------
// AFE live (30 fps frame data + latency + bypass)
// ---------------------------------------------------------------------------

interface LiveAfeValue {
  frameData: Record<string, StageFrameData>
  latencyMs: number
  /** Whether the AFE pipeline is running (drives the top-bar mini bar). */
  running: boolean
  /** AFE stage bypass — mirrors the workspace snapshot's afeStages toggles. */
  bypass: Record<AfeStageId, boolean>
  toggleBypass: (id: AfeStageId) => void
  /** Feed one stage frame (called by the AFE panel's onFrame). */
  pushFrame: (f: StageFrameData) => void
  setLatency: (ms: number) => void
  setRunning: (running: boolean) => void
}

const LiveAfeContext = React.createContext<LiveAfeValue | null>(null)

export function LiveAfeProvider({
  initialBypass,
  children,
}: {
  initialBypass: Record<AfeStageId, boolean>
  children: React.ReactNode
}) {
  const [frameData, setFrameData] = React.useState<Record<string, StageFrameData>>({})
  const [latencyMs, setLatencyMs] = React.useState(0)
  const [running, setRunningState] = React.useState(false)
  const [bypass, setBypass] = React.useState<Record<AfeStageId, boolean>>(initialBypass)

  const pushFrame = React.useCallback((f: StageFrameData) => {
    setFrameData((prev) => ({ ...prev, [f.stageId]: f }))
  }, [])

  const setLatency = React.useCallback((ms: number) => setLatencyMs(ms), [])
  const setRunning = React.useCallback((r: boolean) => setRunningState(r), [])

  const toggleBypass = React.useCallback((id: AfeStageId) => {
    setBypass((prev) => ({ ...prev, [id]: !prev[id] }))
  }, [])

  const value = React.useMemo(
    () => ({ frameData, latencyMs, running, bypass, toggleBypass, pushFrame, setLatency, setRunning }),
    [frameData, latencyMs, running, bypass, toggleBypass, pushFrame, setLatency, setRunning],
  )
  return <LiveAfeContext.Provider value={value}>{children}</LiveAfeContext.Provider>
}

export function useLiveAfe(): LiveAfeValue {
  const v = React.useContext(LiveAfeContext)
  if (!v) throw new Error('useLiveAfe must be used inside <LiveAfeProvider>')
  return v
}

// ---------------------------------------------------------------------------
// KWS live (score history ref + detection threshold for the preview curve)
// ---------------------------------------------------------------------------

interface LiveKwsValue {
  /** Score history — a ref so it never triggers re-renders (the curve canvas
   *  polls it in its rAF loop). */
  historyRef: React.MutableRefObject<KWSScoreSample[]>
  /** Detection threshold used by the preview score curve. */
  threshold: number
  setThreshold: (t: number) => void
  /** Whether KWS detection is running (top-bar mini bar). */
  kwsRunning: boolean
  setKwsRunning: (r: boolean) => void
}

const LiveKwsContext = React.createContext<LiveKwsValue | null>(null)

export function LiveKwsProvider({ children }: { children: React.ReactNode }) {
  const historyRef = React.useRef<KWSScoreSample[]>([])
  const [threshold, setThreshold] = React.useState(0.5)
  const [kwsRunning, setKwsRunningState] = React.useState(false)
  const setKwsRunning = React.useCallback((r: boolean) => setKwsRunningState(r), [])
  const value = React.useMemo(
    () => ({ historyRef, threshold, setThreshold, kwsRunning, setKwsRunning }),
    [threshold, kwsRunning, setKwsRunning],
  )
  return <LiveKwsContext.Provider value={value}>{children}</LiveKwsContext.Provider>
}

export function useLiveKws(): LiveKwsValue {
  const v = React.useContext(LiveKwsContext)
  if (!v) throw new Error('useLiveKws must be used inside <LiveKwsProvider>')
  return v
}
