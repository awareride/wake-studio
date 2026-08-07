import { useCallback, useEffect, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import type { AFEPipeline } from '@wake-studio/module-afe-graph'
import { AFEPipeline as AFEPipelineClass } from '@wake-studio/module-afe-graph'
import { describeParameters } from '@wake-studio/module-afe-graph'
import { UnifiedConfigPanel } from './UnifiedConfigPanel'
import { useProjectStageConfig } from '../projects'
import { logInfo, logError } from '../log'
import { PersistencePanel } from './PersistencePanel'
import { FileScheduler } from '../workspace/sources/fileSource'
import type { FileSourceItem } from '../workspace/types'
import type { SourceState } from '../workspace/useSourceConfig'
import type { PanelCommands } from '../workspace/usePipelineRunner'
import { useLiveAfe, type AfeStageId } from '../workspace/live'

interface AFEPanelProps {
  afeRef: MutableRefObject<AFEPipeline | null>
  onRunningChange: (running: boolean) => void
  /** Optional: external control (workspace pipeline runner) to start/stop. */
  commandRef?: MutableRefObject<PanelCommands | null>
  /** Input source (Step A) — read at start time. */
  source: SourceState
  /** Stage bypass toggle — owned by the workspace (context + persist). */
  onToggleBypass: (id: AfeStageId) => void
}

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

/**
 * AFE configuration panel (Step B + Step D, epic #53 P7).
 *
 * Owns the pipeline lifecycle (the workspace runner drives it via
 * commandRef), the spec-driven ADR-017 config, and the persistence panel.
 * Live preview (overview + stage cards) renders in the Phase 2 container via
 * the shared live context — this panel only feeds it.
 */
export function AFEPanel({ afeRef, onRunningChange, commandRef, source, onToggleBypass }: AFEPanelProps) {
  const { projectConfig: projCfg, persist } = useProjectStageConfig('afe')
  // Workspace snapshot holds the per-project stage toggles (epic #53); the
  // AFE bypass flags mirror them. Falls back to module defaults (AEC/BSS
  // passthrough, NS active) when no workspace snapshot exists yet.
  const { projectConfig: wsCfg, persist: persistWs } = useProjectStageConfig('workspace')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Seed vizFps from the active project's AFE snapshot (falls back to 30).
  const [vizFps, setVizFps] = useState(projCfg?.vizFps ?? 30)
  // Live preview state lives in the shared context (Phase 2 consumes it).
  const { bypass, pushFrame, setLatency } = useLiveAfe()

  // Latest source for handleStart (source lives in Step A, this panel only
  // reads it at start time — keep handleStart identity stable via a ref).
  const sourceRef = useRef(source)
  sourceRef.current = source

  const params = describeParameters()

  const handleStart = useCallback(async () => {
    setError(null)
    if (!afeRef.current) {
      afeRef.current = new AFEPipelineClass()
    }
    const p = afeRef.current
    p.onFrame((f) => pushFrame(f))
    const src = sourceRef.current
    try {
      if (src.kind === 'file') {
        // Build the file scheduler and hand its output to the pipeline.
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
      onRunningChange(true)
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
  }, [afeRef, onRunningChange, pushFrame])

  const handleStop = useCallback(() => {
    afeRef.current?.stop()
    setRunning(false)
    onRunningChange(false)
    setLatency(0)
    logInfo('afe', 'Pipeline stopped')
  }, [afeRef, onRunningChange, setLatency])

  // Expose start/stop to the workspace pipeline runner via commandRef.
  useEffect(() => {
    if (commandRef) {
      commandRef.current = { start: handleStart, stop: handleStop }
    }
  }, [commandRef, handleStart, handleStop])

  // Poll latency into the live context while running (Phase 2 overview shows
  // it); no local copy needed.
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => {
      if (afeRef.current) {
        setLatency(afeRef.current.latencyMs)
      }
    }, 200)
    return () => clearInterval(id)
  }, [running, afeRef, setLatency])

  // Cleanup on unmount. The callback identity is tracked via a ref so the
  // teardown only runs on a real unmount (project switch remounts the panel
  // via key), not on every WorkspaceView re-render (onRunningChange is an
  // inline arrow there — depending on it would stop a freshly started
  // pipeline on any parent re-render).
  const onRunningChangeRef = useRef(onRunningChange)
  onRunningChangeRef.current = onRunningChange
  useEffect(() => {
    return () => {
      afeRef.current?.stop()
      onRunningChangeRef.current(false)
    }
  }, [afeRef])

  return (
    <section className="space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-ink-1">Live AFE pipeline</h2>
          <p className="text-xs text-ink-3">
            AEC (passthrough) &rarr; BSS (passthrough) &rarr; NS (RNNoise
            WASM) &middot; ADR-016
          </p>
        </div>
        {running && (
          <span className="flex items-center gap-1.5 whitespace-nowrap text-xs font-medium text-success">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-success" />
            running
          </span>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      )}

      {/* Step D · persistence (epic #53 P5): config + capture + replay. */}
      <PersistencePanel
        pipeline={afeRef.current}
        running={running}
        config={wsCfg?.persistence}
        onChange={(persistence) => persistWs({ persistence })}
      />

      {/* Step B · spec-driven config (ADR-017). */}
      <div className="rounded-xl border border-line bg-surface-2 p-5">
        <h3 className="mb-4 text-sm font-semibold text-ink-1">
          Configuration{' '}
          <span className="text-xs font-normal text-ink-3">(ADR-017)</span>
        </h3>
        <UnifiedConfigPanel
          title="Pipeline parameters"
          subtitle="Rendered from describeParameters() via module-kit controls."
          params={params}
          values={{
            vizFps,
            topology: projCfg?.topology ?? 'single-worklet',
            latencyBudgetMs: projCfg?.latencyBudgetMs ?? 150,
            'bypass.aec': bypass.aec,
            'bypass.bss': bypass.bss,
            'bypass.ns': bypass.ns,
          }}
          onParamChange={(id, v) => {
            if (id === 'vizFps') {
              const n = Number(v)
              setVizFps(n)
              afeRef.current?.setConfig({ vizFps: n })
              persist({ vizFps: n })
            } else if (id === 'topology') {
              const t = v as 'single-worklet' | 'node-per-stage'
              afeRef.current?.setConfig({ topology: t })
              persist({ topology: t })
            } else if (id === 'latencyBudgetMs') {
              const n = Number(v)
              afeRef.current?.setConfig({ latencyBudgetMs: n })
              persist({ latencyBudgetMs: n })
            } else if (id.startsWith('bypass.')) {
              const stageId = id.slice('bypass.'.length) as AfeStageId
              onToggleBypass(stageId)
            }
          }}
          advancedIds={['bypass.aec', 'bypass.bss', 'bypass.ns', 'latencyBudgetMs']}
          disabled={running}
        />
        <p className="mt-3 text-xs text-ink-3">
          {params.length} parameters exposed via{' '}
          <code className="text-ink-2">describeParameters()</code> · config
          panel is built incrementally per phase.
        </p>
      </div>
    </section>
  )
}
