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
import type { AFEPipeline, QualificationResult } from '@wake-studio/module-afe-graph'
import { AFEPipeline as AFEPipelineClass } from '@wake-studio/module-afe-graph'
import { logInfo, logError } from '../log'
import { FileScheduler } from '../workspace/sources/fileSource'
import type { FileSourceItem } from '../workspace/types'
import type { SourceState } from '../workspace/useSourceConfig'
import type { PanelCommands } from '../workspace/usePipelineRunner'
import { useLiveAfe } from '../workspace/live'
import { readCachedQualification, writeCachedQualification } from './qualificationCache'

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
  /** Live capture/array qualification verdict (#246); null until reported. */
  qualification: QualificationResult | null
  /** False when the shown verdict is a cached one, not the current capture. */
  qualificationLive: boolean
  /** Re-measure the verdict for the running capture (#246). */
  requalify: () => void
} {
  const afeRef = useRef<AFEPipeline | null>(null)
  const commandRef = useRef<PanelCommands | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Capture qualification (#246): the live verdict plus the last measured one
  // for this device/channel-count signature, so the source panel can show an
  // honest state before Start as well as while running.
  const [qualification, setQualification] = useState<QualificationResult | null>(() => {
    const src = opts.sourceRef.current
    if (src.kind !== 'mic') return null
    const cached = readCachedQualification({
      deviceId: src.mic.deviceId,
      channelCount: src.mic.channelCount ?? 1,
    })
    // A cached entry records the verdict, not the decision it licensed; the
    // spatial gate is derived from the level here, exactly as
    // `evaluateQualification` derives it on a fresh report.
    return cached
      ? {
          level: cached.level,
          spatialSupported: cached.level === 'qualified',
          reasons: cached.reasons,
        }
      : null
  })
  const { pushFrame, setLatency, setRunning, running } = useLiveAfe()
  /** Whether `qualification` was measured by the current run (vs. cached). */
  const [qualificationLive, setQualificationLive] = useState(false)

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
      // A new capture must be re-qualified (#246): drop the previous run's
      // verdict so nothing stale is read as current.
      setQualification(null)
      setQualificationLive(false)
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

  // Poll latency *and* the capture qualification verdict into React state
  // while running (#246). The verdict only changes when a new report arrives
  // (same object reference otherwise), so this adds no render churn.
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => {
      const p = afeRef.current
      if (!p) return
      setLatency(p.latencyMs)
      const q = p.getCaptureQualification()
      setQualification((prev) => (prev === q ? prev : q))
      if (q !== null) setQualificationLive(true)
    }, 200)
    return () => clearInterval(id)
  }, [running, setLatency])

  // Remember the live verdict for this capture signature, so the next session
  // knows what this device delivered (#246).
  useEffect(() => {
    if (!qualification) return
    const src = opts.sourceRef.current
    if (src.kind !== 'mic') return
    writeCachedQualification(
      { deviceId: src.mic.deviceId, channelCount: src.mic.channelCount ?? 1 },
      qualification,
    )
  }, [qualification, opts.sourceRef])

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

  const requalify = useCallback(() => {
    // Drop the shown verdict first, so a stale one is never read as current
    // while the new observation window accumulates.
    setQualification(null)
    setQualificationLive(false)
    try {
      afeRef.current?.requalify()
    } catch {
      // Not running: nothing to re-measure. The UI disables the button in
      // this state and keeps the last measured verdict instead.
    }
  }, [afeRef])

  return {
    afeRef,
    running,
    error,
    commandRef,
    start,
    stop,
    clearError: () => setError(null),
    qualification,
    qualificationLive,
    requalify,
  }
}
