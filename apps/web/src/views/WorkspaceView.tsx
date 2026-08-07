/**
 * Workspace view (epic #53 UX overhaul).
 *
 * Two exclusive modes:
 *  - CONFIGURE (not running): a pipeline-shaped tab flow — Source → AEC →
 *    BSS → NS → KWS — each tab showing the module's config plus a compact
 *    core-preview on the node itself. Persistence toggles live inside each
 *    module's panel.
 *  - RUN (after Start): a full dashboard with every module's live output
 *    (overview + stage cards + score curve + clips). Only Stop returns to
 *    config. The workspace stays mounted across route changes (App keep-alive)
 *    so the pipeline keeps running while browsing other menus.
 *
 * Engine lifecycle lives in useAfePipeline; live preview data flows through
 * the shared live context (workspace/live.tsx).
 */

import * as React from 'react'
import { KWSPanel } from '../components/KWSPanel'
import { ProjectBar } from '../components/ProjectBar'
import { PipelineTabs, type PipelineTabId } from '../components/PipelineTabs'
import { PipelineOverview } from '../components/PipelineOverview'
import { StagePanel } from '../components/viz/StageCard'
import { ScoreCurvePanel } from '../components/ScoreCurvePanel'
import { ClipsPanel } from '../components/ClipsPanel'
import { SourcePanel, StageModulePanel, NsPanel } from '../components/ModulePanels'
import { PersistenceStageToggle } from '../components/PersistenceStageToggle'
import {
  PipelineCanvas,
  type ComponentSelection,
} from '../components/PipelineCanvas'
import type { AFEPipeline } from '@wake-studio/module-afe-graph'
import { useConsoleStatus } from '../status'
import { useProjects, useProjectStageConfig } from '../projects'
import { usePipelineRunner, type PanelCommands } from '../workspace/usePipelineRunner'
import { useSourceConfig } from '../workspace/useSourceConfig'
import { useAfePipeline } from '../workspace/useAfePipeline'
import { LiveAfeProvider, LiveKwsProvider, useLiveAfe, type AfeStageId } from '../workspace/live'
import { useToast } from '../components/toast'

/** All-off persistence record (used before a project snapshot exists). */
const EMPTY_PERSISTENCE: import('../workspace/types').WorkspaceConfig['persistence'] = {
  raw: { enabled: false },
  ns: { enabled: false },
  kws: { enabled: false },
}

export function WorkspaceView() {
  const afeCommandRef = React.useRef<PanelCommands | null>(null)
  const kwsCommandRef = React.useRef<PanelCommands | null>(null)
  const { setStatus } = useConsoleStatus()
  const { current } = useProjects()
  const { toast } = useToast()

  const { projectConfig: wsCfg, persist: persistWs } = useProjectStageConfig('workspace')
  const { projectConfig: afeCfg, persist: persistAfe } = useProjectStageConfig('afe')

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
            afeCommandRef={afeCommandRef}
            kwsCommandRef={kwsCommandRef}
            selection={selection}
            updateSelection={updateSelection}
            kwsPreloadOnStart={kwsPreloadOnStart}
            setKwsPreloadOnStart={setKwsPreloadOnStart}
            fallbackChannels={afeCfg?.channels ?? 1}
            runState={runState}
            onStart={handleStart}
            onStop={handleStop}
            setStatus={setStatus}
            persistWs={persistWs}
            persistAfe={persistAfe}
            afeCfg={afeCfg}
            wsCfg={wsCfg}
            current={current}
          />
        </LiveKwsProvider>
      </LiveAfeProvider>
    </div>
  )
}

function WorkspaceInner({
  afeCommandRef,
  kwsCommandRef,
  selection,
  updateSelection,
  kwsPreloadOnStart,
  setKwsPreloadOnStart,
  fallbackChannels,
  runState,
  onStart,
  onStop,
  setStatus,
  persistWs,
  persistAfe,
  afeCfg,
  wsCfg,
  current,
}: {
  afeCommandRef: React.MutableRefObject<PanelCommands | null>
  kwsCommandRef: React.MutableRefObject<PanelCommands | null>
  selection: ComponentSelection
  updateSelection: (next: ComponentSelection) => void
  kwsPreloadOnStart: boolean
  setKwsPreloadOnStart: (v: boolean) => void
  fallbackChannels: 1 | 2
  runState: {
    phase: import('../workspace/usePipelineRunner').PipelinePhase
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
  persistAfe: (patch: Record<string, unknown>) => void
  afeCfg: { channels?: 1 | 2; topology?: 'single-worklet' | 'node-per-stage'; latencyBudgetMs?: number; vizFps?: number } | undefined
  wsCfg: import('../workspace/types').WorkspaceConfig | undefined
  current: { id: string; name: string } | null
}) {
  const { frameData, latencyMs, bypass, toggleBypass } = useLiveAfe()
  const [afePipeline, setAfePipeline] = React.useState<AFEPipeline | null>(null)

  // Persistence config — lifted here (not straight from the snapshot) so the
  // per-module toggles AND the run-dashboard clips panel share one source of
  // truth even without an active project (persist no-ops then).
  const [persistence, setPersistenceState] = React.useState<
    import('../workspace/types').WorkspaceConfig['persistence']
  >(() => wsCfg?.persistence ?? EMPTY_PERSISTENCE)
  React.useEffect(() => {
    setPersistenceState(wsCfg?.persistence ?? EMPTY_PERSISTENCE)
  }, [wsCfg?.persistence])
  const setPersistence = React.useCallback(
    (next: import('../workspace/types').WorkspaceConfig['persistence']) => {
      setPersistenceState(next)
      persistWs({ persistence: next })
    },
    [persistWs],
  )

  // Step A source state (P7): re-seeded per project via the keyed wrapper.
  const source = useSourceConfig(wsCfg, persistWs, fallbackChannels)
  const sourceRef = React.useRef(source)
  sourceRef.current = source

  // AFE engine lifecycle (commandRef feeds the unified runner).
  const { afeRef, running, error, commandRef } = useAfePipeline({
    sourceRef,
    onRunningChange: (r) => {
      setAfePipeline(afeRef.current)
      setStatus({ mic: r ? 'active' : 'idle' })
    },
  })
  // Keep the runner's afe commands in sync (useAfePipeline owns the ref).
  React.useEffect(() => {
    afeCommandRef.current = commandRef.current
  }, [afeCommandRef, commandRef])

  // Active config tab (Source by default; KWS only selectable when enabled).
  const [activeTab, setActiveTab] = React.useState<PipelineTabId>('source')
  const activeTabRef = React.useRef(activeTab)
  activeTabRef.current = activeTab

  // KWS core preview for the tab node (reported by the KWS panel).
  const [kwsPreview, setKwsPreview] = React.useState('kws · idle')

  // Single source of truth for the AFE stage bypass: toggle the live context
  // AND persist to the workspace snapshot.
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

  const sourcePreview =
    source.kind === 'file' ? `Files (${source.files.length})` : 'Mic · default'

  const tabItems = [
    { id: 'source' as const, label: 'Source', preview: sourcePreview },
    {
      id: 'aec' as const,
      label: 'AEC',
      preview: bypass.aec ? 'Bypassed' : 'Active',
      badge: bypass.aec ? undefined : 'on',
    },
    {
      id: 'bss' as const,
      label: 'BSS',
      preview: bypass.bss ? 'Bypassed' : 'Active',
      badge: bypass.bss ? undefined : 'on',
    },
    {
      id: 'ns' as const,
      label: 'NS',
      preview: bypass.ns ? 'Bypassed' : 'Active',
      badge: persistence?.ns?.enabled ? 'persist' : undefined,
    },
    ...(selection.kws
      ? [{ id: 'kws' as const, label: 'KWS', preview: kwsPreview, badge: persistence?.kws?.enabled ? 'persist' : undefined }]
      : []),
  ]

  return (
    <div className="space-y-4">
      {/* Run control + component selection (kept, e2e-pinned). */}
      <PipelineCanvas
        selection={selection}
        onSelectionChange={updateSelection}
        runState={runState}
        onStart={onStart}
        onStop={onStop}
        status={useConsoleStatus().status}
      />

      {error && (
        <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      )}

      {/* ============ CONFIGURE (before Start) ============ */}
      {!previewVisible && (
        <section className="rounded-2xl border border-line bg-surface-1 p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2 border-b border-line pb-3">
            <span className="rounded bg-brand-500/20 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-widest text-brand-300">
              Phase 1 · Configure
            </span>
            <span className="text-xs text-ink-3">
              configure each module, then Start — Stop returns here
            </span>
          </div>

          <div className="mb-4">
            <PipelineTabs
              active={activeTab}
              onSelect={setActiveTab}
              tabs={tabItems}
            />
          </div>

          {/* Active module panel. Panels stay mounted (hidden) so engines and
              form state survive tab switches. */}
          <div className={activeTab === 'source' ? '' : 'hidden'}>
            <SourcePanel
              source={source}
              actions={source}
              afeRef={afeRef}
              running={running}
              projCfg={afeCfg}
              persistAfe={persistAfe}
              persistence={persistence}
              setPersistence={setPersistence}
            />
          </div>
          <div className={activeTab === 'aec' ? '' : 'hidden'}>
            <StageModulePanel
              id="aec"
              title="AEC · Acoustic echo cancellation"
              note="Passthrough for v1 (ADR-016); the real engine + persistence wiring lands with it."
              bypassed={bypass.aec}
              onToggleBypass={handleToggleBypass}
            />
          </div>
          <div className={activeTab === 'bss' ? '' : 'hidden'}>
            <StageModulePanel
              id="bss"
              title="BSS · Blind source separation"
              note="Passthrough for v1 (ADR-016); single-mic pipeline. Persistence lands with the real engine."
              bypassed={bypass.bss}
              onToggleBypass={handleToggleBypass}
            />
          </div>
          <div className={activeTab === 'ns' ? '' : 'hidden'}>
            <NsPanel
              bypassed={bypass.ns}
              onToggleBypass={handleToggleBypass}
              persistence={persistence}
              setPersistence={setPersistence}
            />
          </div>
          {selection.kws && (
            <div className={activeTab === 'kws' ? '' : 'hidden'}>
              {/* KWS preload toggle (confirmed decision §11.2). */}
              <label className="mb-4 flex items-center gap-2 rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm">
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
                onPreview={setKwsPreview}
              />
              <div className="mt-4 rounded-xl border border-line bg-surface-3 p-4">
                <PersistenceStageToggle
                  stageId="kws"
                  label="Persist KWS output (16 kHz stream)"
                  config={persistence}
                  onChange={setPersistence}
                />
              </div>
            </div>
          )}
        </section>
      )}

      {/* ============ RUN dashboard (after Start) ============ */}
      {previewVisible && (
        <section className="rounded-2xl border border-line bg-surface-1 p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2 border-b border-line pb-3">
            <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-widest text-emerald-300">
              Phase 2 · Preview
            </span>
            <span className="text-xs text-ink-3">live effects — Stop to reconfigure</span>
            <button
              onClick={onStop}
              className="ml-auto flex items-center gap-1.5 rounded-lg bg-danger/90 px-3 py-1.5 text-sm font-medium text-ink-1 hover:bg-red-500"
            >
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="1.5" />
              </svg>
              Stop
            </button>
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
            <ClipsPanel
              pipeline={afeRef.current}
              running={running}
              config={persistence}
            />
          </div>
        </section>
      )}
    </div>
  )
}
