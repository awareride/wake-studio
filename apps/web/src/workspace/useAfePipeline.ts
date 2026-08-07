/**
 * AFE pipeline lifecycle hook (epic #53 UX overhaul).
 *
 * Owns the AFE engine instance + start/stop so the config panels (Source /
 * AEC / BSS / NS tabs) stay pure: they read the source via a ref and apply
 * params via `afeRef`, but never create or own the engine. Live frame data +
 * latency flow into the shared live context for the run dashboard.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import type { AFEPipeline } from '@wake-studio/module-afe-graph'
import { AFEPipeline as AFEPipelineClass } from '@wake-studio/module-afe-graph'
import { logInfo, logError } from '../log'
import { FileScheduler } from '../workspace/sources/fileSource'
import type { FileSourceItem } from '../workspace/types'
import type { SourceState } from '../workspace/useSourceConfig'
import type { PanelCommands } from '../workspace/usePipelineRunner'
import { useLiveAfe } from '../workspace/live'

/** Build a FileScheduler from the selected files (epic #53 P3). Returns null
 *  when there are no files with a decodable buffer. */
function buildFileScheduler(files: FileSourceItem[]): FileScheduler | null {
  const decodable = files.filter((f) => f.buffer)
  if (decodable.length === 0) return null
  const ctx = new AudioContext({ sampleRate: 48000 })
  if (ctx.state === 'suspended') void ctx.resume()
  const scheduler = new FileScheduler(ctx)
  for (const f of decodable) {
    scheduler.addFile(
      {
        id: f.name,
        name: f.name,
        buffer: f.buffer!,
        sampleRate: f.sampleRate,
        durationMs: f.durationMs,
        channelCount: f.channels.length,
      },
      f.channels,
    )
  }
  return scheduler
}

export function useAfePipeline(opts: {
  /** Latest input source (Step A) — read at start time via a ref. */
  sourceRef: MutableRefObject<SourceState>
  onRunningChange: (running: boolean) => void
}): {
  afeRef: MutableRefObject<AFEPipeline | null>
  running: boolean
  error: string | null
  commandRef: MutableRefObject<PanelCommands | null>
  start: () => Promise<void>
  stop: () => void
  clearError: () => void
} {
  const afeRef = useRef<AFEPipeline | null>(null)
  const commandRef = useRef<PanelCommands | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { pushFrame, setLatency } = useLiveAfe()

  const start = useCallback(async () => {
    setError(null)
    if (!afeRef.current) {
      afeRef.current = new AFEPipelineClass()
    }
    const p = afeRef.current
    p.onFrame((f) => pushFrame(f))
    const src = opts.sourceRef.current
    try {
      if (src.kind === 'file') {
        const scheduler = buildFileScheduler(src.files)
        if (!scheduler) {
          setError('Add at least one audio file first.')
          return
        }
        afeRef.current = new AFEPipelineClass()
        const p = afeRef.current
        p.onFrame((f) => pushFrame(f))
        await p.start({ nodes: [scheduler.output], dispose: () => scheduler.dispose() })
      } else {
        await p.start(src.mic)
      }
      setRunning(true)
      opts.onRunningChange(true)
      logInfo(
        'afe',
        src.kind === 'file'
          ? `Pipeline started (file source, ${src.files.length} file(s))`
          : 'Pipeline started (microphone live)',
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      logError('afe', err instanceof Error ? err.message : String(err))
    }
  }, [opts, pushFrame])

  const stop = useCallback(() => {
    afeRef.current?.stop()
    setRunning(false)
    opts.onRunningChange(false)
    setLatency(0)
    logInfo('afe', 'Pipeline stopped')
  }, [opts, setLatency])

  // Expose start/stop to the workspace pipeline runner via commandRef.
  useEffect(() => {
    commandRef.current = { start, stop }
  }, [start, stop])

  // Poll latency into the live context while running.
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => {
      if (afeRef.current) {
        setLatency(afeRef.current.latencyMs)
      }
    }, 200)
    return () => clearInterval(id)
  }, [running, setLatency])

  // Cleanup on unmount (app teardown — the workspace stays mounted across
  // route changes, so this only fires on a full unmount).
  const onRunningChangeRef = useRef(opts.onRunningChange)
  onRunningChangeRef.current = opts.onRunningChange
  useEffect(() => {
    return () => {
      afeRef.current?.stop()
      onRunningChangeRef.current(false)
    }
  }, [])

  return {
    afeRef,
    running,
    error,
    commandRef,
    start,
    stop,
    clearError: () => setError(null),
  }
}
