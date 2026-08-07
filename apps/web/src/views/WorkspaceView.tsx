/**
 * Workspace view (epic #53) - project bar + component-selection pipeline
 * canvas + unified run control + live panels.
 *
 * P4: the top canvas owns component selection (AFE + stages + KWS) and a
 * single Start/Stop that drives the whole pipeline through usePipelineRunner
 * (AFE first, then auto-load + auto-start KWS when enabled + preload ON).
 * The KWS panel keeps its Load/Reload + EP label + Stop detection (e2e).
 */

import * as React from 'react'
import { AFEPanel } from '../components/AFEPanel'
import { KWSPanel } from '../components/KWSPanel'
import { ProjectBar } from '../components/ProjectBar'
import {
  PipelineCanvas,
  type ComponentSelection,
} from '../components/PipelineCanvas'
import type { AFEPipeline } from '@wake-studio/module-afe-graph'
import { useConsoleStatus } from '../status'
import { useProjects, useProjectStageConfig } from '../projects'
import { usePipelineRunner, type PanelCommands } from '../workspace/usePipelineRunner'
import { useToast } from '../components/toast'

export function WorkspaceView() {
  const afeRef = React.useRef<AFEPipeline | null>(null)
  // Mirrors afeRef.current in state so children (KWSPanel) re-render when the
  // pipeline instance is created (ref changes alone don't trigger renders).
  const [afePipeline, setAfePipeline] = React.useState<AFEPipeline | null>(null)
  const afeCommandRef = React.useRef<PanelCommands | null>(null)
  const kwsCommandRef = React.useRef<PanelCommands | null>(null)
  const { setStatus } = useConsoleStatus()
  const { current } = useProjects()
  const { toast } = useToast()

  // Component selection + KWS preload persisted in the workspace snapshot.
  const { projectConfig: wsCfg, persist: persistWs } = useProjectStageConfig('workspace')
  const [selection, setSelection] = React.useState<ComponentSelection>(() => ({
    afe: wsCfg?.enabled?.afe ?? true,
    afeStages: {
      aec: wsCfg?.enabled?.afeStages?.aec ?? true,
      bss: wsCfg?.enabled?.afeStages?.bss ?? true,
      ns: wsCfg?.enabled?.afeStages?.ns ?? false,
    },
    kws: wsCfg?.enabled?.kws ?? false,
  }))
  const [kwsPreloadOnStart, setKwsPreloadOnStart] = React.useState(
    wsCfg?.kwsPreloadOnStart ?? true,
  )

  const updateSelection = React.useCallback(
    (next: ComponentSelection) => {
      setSelection(next)
      persistWs({ enabled: next })
    },
    [persistWs],
  )

  // Source label for the canvas (from the workspace snapshot source).
  const sourceLabel = React.useMemo(() => {
    const s = wsCfg?.source
    if (s?.kind === 'file') {
      return `Files (${s.files.length})`
    }
    if (s?.kind === 'mic' && s.mic.deviceId) {
      return 'Mic · selected'
    }
    return 'Mic · default'
  }, [wsCfg])

  const { state, start, stop } = usePipelineRunner(
    afeCommandRef,
    kwsCommandRef,
    { kwsEnabled: selection.kws, kwsPreloadOnStart },
  )

  const handleStart = React.useCallback(() => {
    void start().then(() => {
      if (state.error) {
        toast({ title: 'Pipeline start failed', description: state.error, variant: 'error' })
      }
    })
  }, [start, state.error, toast])

  const handleStop = React.useCallback(() => {
    stop()
  }, [stop])

  const runState = {
    phase: state.phase,
    afeRunning: state.afeRunning,
    kwsRunning: state.kwsRunning,
    kwsReady: state.kwsReady,
    kwsLoading: state.kwsLoading,
    error: state.error,
    sourceLabel,
  }

  return (
    <div className="space-y-6">
      {/* Welcome + project bar */}
      <div className="rounded-xl border border-line bg-gradient-to-br from-brand-50 to-surface-2 p-5">
        <h2 className="text-lg font-semibold text-ink-1">Workspace</h2>
        <p className="mt-1 text-sm text-ink-2">
          Build, visualize and test on-device wake-word pipelines — all in the
          browser. Select or create a project, then run the pipeline.
        </p>
      </div>

      <ProjectBar />

      <PipelineCanvas
        selection={selection}
        onSelectionChange={updateSelection}
        runState={runState}
        onStart={handleStart}
        onStop={handleStop}
        status={useConsoleStatus().status}
      />

      {/* KWS preload toggle (confirmed decision §11.2). */}
      {selection.kws && (
        <label className="flex items-center gap-2 rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm">
          <input
            type="checkbox"
            checked={kwsPreloadOnStart}
            onChange={(e) => {
              setKwsPreloadOnStart(e.target.checked)
              persistWs({ kwsPreloadOnStart: e.target.checked })
            }}
            className="h-3.5 w-3.5 rounded accent-brand-500"
          />
          <span className="text-ink-2">Preload KWS models on Start</span>
          <span className="text-xs text-ink-3">
            (off = Start runs AFE only until you load models manually)
          </span>
        </label>
      )}

      {/* Live DSP panels */}
      <div className="space-y-8">
        <AFEPanel
          key={`afe-${current?.id ?? 'none'}`}
          afeRef={afeRef}
          onRunningChange={(r) => {
            setAfePipeline(afeRef.current)
            setStatus({ mic: r ? 'active' : 'idle' })
          }}
          commandRef={afeCommandRef}
        />
        <KWSPanel
          key={`kws-${current?.id ?? 'none'}`}
          afePipeline={afePipeline}
          afeRunning={state.afeRunning}
          commandRef={kwsCommandRef}
        />
      </div>

      {current && (
        <p className="text-xs text-ink-3">
          Active project:{' '}
          <span className="font-medium text-ink-2">{current.name}</span> · config
          snapshots are saved with the project.
        </p>
      )}
    </div>
  )
}
