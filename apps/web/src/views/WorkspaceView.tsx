/**
 * Workspace view (epic #53) - Phase 1 Configure / Phase 2 Preview layout.
 *
 * P7 restructure (plan §2 + §8): configuration groups at the top in
 * collapsible Step sections (A components+source, B AFE, C KWS, D
 * persistence), effects group after Start in one Phase 2 preview container
 * (pipeline overview + stage cards + KWS score curve). The engine panels own
 * the pipeline/engine lifecycle; live preview data flows through the shared
 * live context (`workspace/live.tsx`).
 */

import * as React from 'react'
import { AFEPanel } from '../components/AFEPanel'
import { KWSPanel } from '../components/KWSPanel'
import { ProjectBar } from '../components/ProjectBar'
import { SourceConfigSection } from '../components/SourceConfigSection'
import { StepSection } from '../components/StepSection'
import { PipelineOverview } from '../components/PipelineOverview'
import { StagePanel } from '../components/viz/StageCard'
import { ScoreCurvePanel } from '../components/ScoreCurvePanel'
import {
  PipelineCanvas,
  type ComponentSelection,
} from '../components/PipelineCanvas'
import type { AFEPipeline } from '@wake-studio/module-afe-graph'
import { useConsoleStatus } from '../status'
import { useProjects, useProjectStageConfig } from '../projects'
import { usePipelineRunner, type PanelCommands, type PipelinePhase } from '../workspace/usePipelineRunner'
import { useSourceConfig } from '../workspace/useSourceConfig'
import { LiveAfeProvider, LiveKwsProvider, useLiveAfe, type AfeStageId } from '../workspace/live'
import { useToast } from '../components/toast'

export function WorkspaceView() {
  const afeRef = React.useRef<AFEPipeline | null>(null)
  const afeCommandRef = React.useRef<PanelCommands | null>(null)
  const kwsCommandRef = React.useRef<PanelCommands | null>(null)
  const { setStatus } = useConsoleStatus()
  const { current } = useProjects()
  const { toast } = useToast()

  // Component selection + KWS preload persisted in the workspace snapshot.
  const { projectConfig: wsCfg, persist: persistWs } = useProjectStageConfig('workspace')
  const { projectConfig: afeCfg } = useProjectStageConfig('afe')

  // Step A source state (lifted from the AFE panel, P7) — lives inside
  // WorkspaceInner (keyed by project) so it re-seeds on project switch.

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
    sourceLabel:
      wsCfg?.source?.kind === 'file'
        ? `Files (${wsCfg.source.files.length})`
        : 'Mic · default',
  }

  // Step A/B/C open state (all open by default; collapsible per P7).
  const [openSteps, setOpenSteps] = React.useState<Record<'A' | 'B' | 'C', boolean>>({
    A: true,
    B: true,
    C: true,
  })
  const toggleStep = (step: 'A' | 'B' | 'C') =>
    setOpenSteps((prev) => ({ ...prev, [step]: !prev[step] }))

  const initialBypass = {
    aec: wsCfg?.enabled?.afeStages?.aec ?? true,
    bss: wsCfg?.enabled?.afeStages?.bss ?? true,
    ns: wsCfg?.enabled?.afeStages?.ns ?? false,
  }

  return (
    <div className="space-y-6">
      {/* Compact page header: title + project bar on one row. */}
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-xl border border-line bg-surface-2 px-4 py-3">
        <div>
          <h2 className="text-base font-semibold text-ink-1">Workspace</h2>
          <p className="text-xs text-ink-3">
            Build, visualize and test on-device wake-word pipelines — all in the
            browser.
          </p>
        </div>
        <ProjectBar />
      </div>

      <LiveAfeProvider key={`afe-live-${current?.id ?? 'none'}`} initialBypass={initialBypass}>
        <LiveKwsProvider key={`kws-live-${current?.id ?? 'none'}`}>
          <WorkspaceInner
            key={`ws-${current?.id ?? 'none'}`}
            afeRef={afeRef}
            afeCommandRef={afeCommandRef}
            kwsCommandRef={kwsCommandRef}
            selection={selection}
            updateSelection={updateSelection}
            kwsPreloadOnStart={kwsPreloadOnStart}
            setKwsPreloadOnStart={setKwsPreloadOnStart}
            fallbackChannels={afeCfg?.channels ?? 1}
            openSteps={openSteps}
            toggleStep={toggleStep}
            runState={runState}
            onStart={handleStart}
            onStop={handleStop}
            setStatus={setStatus}
            persistWs={persistWs}
            wsCfg={wsCfg}
            current={current}
          />
        </LiveKwsProvider>
      </LiveAfeProvider>

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

function WorkspaceInner({
  afeRef,
  afeCommandRef,
  kwsCommandRef,
  selection,
  updateSelection,
  kwsPreloadOnStart,
  setKwsPreloadOnStart,
  fallbackChannels,
  openSteps,
  toggleStep,
  runState,
  onStart,
  onStop,
  setStatus,
  persistWs,
  wsCfg,
  current,
}: {
  afeRef: React.MutableRefObject<AFEPipeline | null>
  afeCommandRef: React.MutableRefObject<PanelCommands | null>
  kwsCommandRef: React.MutableRefObject<PanelCommands | null>
  selection: ComponentSelection
  updateSelection: (next: ComponentSelection) => void
  kwsPreloadOnStart: boolean
  setKwsPreloadOnStart: (v: boolean) => void
  fallbackChannels: 1 | 2
  openSteps: Record<'A' | 'B' | 'C', boolean>
  toggleStep: (step: 'A' | 'B' | 'C') => void
  runState: {
    phase: PipelinePhase
    afeRunning: boolean
    kwsRunning: boolean
    kwsReady: boolean
    kwsLoading: boolean
    error: string | null
    sourceLabel: string
  }
  onStart: () => void
  onStop: () => void
  setStatus: (patch: Partial<import('../status').ConsoleStatus>) => void
  persistWs: (patch: Partial<import('../workspace/types').WorkspaceConfig>) => void
  wsCfg: import('../workspace/types').WorkspaceConfig | undefined
  current: { id: string; name: string } | null
}) {
  const { frameData, latencyMs, bypass, toggleBypass } = useLiveAfe()
  // Mirrors afeRef.current in state so children (KWSPanel) re-render when the
  // pipeline instance is created (ref changes alone don't trigger renders).
  const [afePipeline, setAfePipeline] = React.useState<AFEPipeline | null>(null)

  // Step A source state (P7): lives here (keyed by project via the wrapper)
  // so it re-seeds when switching projects.
  const source = useSourceConfig(wsCfg, persistWs, fallbackChannels)

  // Single source of truth for the AFE stage bypass: toggle the live context
  // AND persist to the workspace snapshot (the `afe` snapshot has no bypass
  // field — workspace snapshot is the home, #53 P1).
  const handleToggleBypass = React.useCallback(
    (stageId: AfeStageId) => {
      const newVal = !bypass[stageId]
      toggleBypass(stageId)
      afeRef.current?.setBypassed(stageId, newVal)
      persistWs({
        enabled: {
          ...(wsCfg?.enabled ?? { afe: true, afeStages: { aec: true, bss: true, ns: false }, kws: false }),
          afeStages: { ...bypass, [stageId]: newVal },
        },
      })
    },
    [afeRef, persistWs, wsCfg, bypass, toggleBypass],
  )

  const previewVisible = runState.afeRunning || runState.kwsRunning

  return (
    <div className="space-y-4">
      {/* ================= Phase 1 · Configure ================= */}
      <section className="rounded-2xl border border-line bg-surface-1 p-4">
        <div className="mb-3 flex items-center gap-2 border-b border-line pb-3">
          <span className="rounded bg-brand-500/20 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-widest text-brand-300">
            Phase 1 · Configure
          </span>
          <span className="text-xs text-ink-3">set up what runs, then start</span>
        </div>

        <div className="space-y-3">
          <StepSection
            step="A"
            title="Components & input source"
            description="pick the stages and where audio comes from"
            open={openSteps.A}
            onToggle={() => toggleStep('A')}
          >
            <PipelineCanvas
              selection={selection}
              onSelectionChange={updateSelection}
              runState={runState}
              onStart={onStart}
              onStop={onStop}
              status={useConsoleStatus().status}
            />
            <SourceConfigSection source={source} actions={source} />
          </StepSection>

          <StepSection
            step="B"
            title="AFE configuration"
            description="pipeline params + per-stage persistence"
            open={openSteps.B}
            onToggle={() => toggleStep('B')}
          >
            <AFEPanel
              key={`afe-${current?.id ?? 'none'}`}
              afeRef={afeRef}
              onRunningChange={(r) => {
                setAfePipeline(afeRef.current)
                setStatus({ mic: r ? 'active' : 'idle' })
              }}
              commandRef={afeCommandRef}
              source={source}
              onToggleBypass={handleToggleBypass}
            />
          </StepSection>

          {/* Step C · KWS config — gated on the KWS component toggle (plan
              §8.1: only when KWS enabled). */}
          {selection.kws && (
            <StepSection
              step="C"
              title="KWS configuration"
              description="backend, models, enrollment"
              open={openSteps.C}
              onToggle={() => toggleStep('C')}
            >
              {/* KWS preload toggle (confirmed decision §11.2). */}
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
              <KWSPanel
                key={`kws-${current?.id ?? 'none'}`}
                afePipeline={afePipeline}
                afeRunning={runState.afeRunning}
                commandRef={kwsCommandRef}
              />
            </StepSection>
          )}
        </div>
      </section>

      {/* ================= Phase 2 · Preview ================= */}
      {previewVisible && (
        <section className="rounded-2xl border border-line bg-surface-1 p-4">
          <div className="mb-3 flex items-center gap-2 border-b border-line pb-3">
            <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-widest text-emerald-300">
              Phase 2 · Preview
            </span>
            <span className="text-xs text-ink-3">live effects after start</span>
          </div>

          <div className="space-y-4">
            <PipelineOverview
              frameData={frameData}
              running={runState.afeRunning}
              latencyMs={latencyMs}
              sourceLabel={source.kind === 'file' ? 'FILE' : 'MIC'}
            />
            <div className="grid gap-4 sm:grid-cols-3 items-stretch">
              {(['aec', 'bss', 'ns'] as const).map((id) => (
                <StagePanel
                  key={id}
                  id={id}
                  data={frameData[id]}
                  isBypassed={bypass[id]}
                  onToggleBypass={handleToggleBypass}
                />
              ))}
            </div>
            {runState.kwsRunning && <ScoreCurvePanel running={runState.kwsRunning} />}
          </div>
        </section>
      )}
    </div>
  )
}
