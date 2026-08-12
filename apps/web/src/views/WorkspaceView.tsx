/**
 * Workspace view (epic #53 UX overhaul).
 *
 * Two exclusive modes:
 *  - CONFIGURE (not running): a pipeline-shaped tab flow — Source → AEC →
 *    BSS → NS → KWS — each tab showing the module's config plus a compact
 *    core-preview on the node itself. Persistence toggles live inside each
 *    module's panel.
 *  - RUN (after Start): a full dashboard with every module's live output.
 *    Only Stop returns to config. The workspace stays mounted across route
 *    changes (App keep-alive) so the pipeline keeps running while browsing
 *    other menus; the top-bar mini pipeline bar shows its status globally.
 *
 * Engine lifecycle lives in useAfePipeline; live preview data flows through
 * the app-level live context (workspace/live.tsx).
 */

import * as React from 'react'
import { KWSPanel } from '../components/KWSPanel'
import { ProjectBar } from '../components/ProjectBar'
import { RecentProjectsMenu } from '../components/RecentProjectsMenu'
import { RunControl, type PipelineRunState } from '../components/RunControl'
import { PipelineTabs, StageCard, type PipelineTabId } from '../components/PipelineTabs'
import { PipelineLevelCurve } from '../components/PipelineOverview'
import { WaveformCanvas, StagePanel } from '../components/viz/StageCard'
import { MiniScoreCurve } from '../components/MiniScoreCurve'
import { ScoreCurvePanel } from '../components/ScoreCurvePanel'
import { ClipsPanel } from '../components/ClipsPanel'
import { SourcePanel, StageModulePanel, NsPanel, StageModuleShell, StageSection } from '../components/ModulePanels'
import { PersistenceStageToggle } from '../components/PersistenceStageToggle'
import type { AFEPipeline } from '@wake-studio/module-afe-graph'
import { useConsoleStatus } from '../status'
import { useProjects, useProjectStageConfig } from '../projects'
import { usePipelineRunner } from '../workspace/usePipelineRunner'
import { useSourceConfig } from '../workspace/useSourceConfig'
import { useAfePipeline } from '../workspace/useAfePipeline'
import { useLiveAfe, useLiveKws, type AfeStageId } from '../workspace/live'
import { useToast } from '../components/toast'

/** Live stage-card glyphs + colors (identical layout to the Setup cards). */
const GLYPHS_LIVE: Record<'aec' | 'bss' | 'ns', string> = { aec: '≈', bss: '⇄', ns: '∿' }
const STAGE_COLORS_LIVE: Record<'aec' | 'bss' | 'ns', string> = {
  aec: '#818cf8',
  bss: '#a78bfa',
  ns: '#38bdf8',
}

/** All-off persistence record (used before a project snapshot exists). */
const EMPTY_PERSISTENCE: import('../workspace/types').WorkspaceConfig['persistence'] = {
  raw: { enabled: false },
  ns: { enabled: false },
  kws: { enabled: false },
}

export function WorkspaceView() {
  const afeCommandRef = React.useRef<import('../workspace/usePipelineRunner').PanelCommands | null>(null)
  const kwsCommandRef = React.useRef<import('../workspace/usePipelineRunner').PanelCommands | null>(null)
  const { setStatus } = useConsoleStatus()
  const { current } = useProjects()
  const { toast } = useToast()

  const { projectConfig: wsCfg, persist: persistWs } = useProjectStageConfig('workspace')
  const { projectConfig: afeCfg, persist: persistAfe } = useProjectStageConfig('afe')

  // KWS component toggle (persisted in the workspace snapshot; gates the KWS
  // config tab + auto-load on Start).
  const [kwsEnabled, setKwsEnabled] = React.useState(wsCfg?.enabled?.kws ?? false)
  const [kwsPreloadOnStart, setKwsPreloadOnStart] = React.useState(
    wsCfg?.kwsPreloadOnStart ?? true,
  )
  const toggleKws = React.useCallback(
    (v: boolean) => {
      setKwsEnabled(v)
      persistWs({
        enabled: {
          ...(wsCfg?.enabled ?? { afe: true, afeStages: { aec: true, bss: true, ns: false }, kws: false }),
          kws: v,
        },
      })
    },
    [persistWs, wsCfg],
  )

  const { state, start, stop } = usePipelineRunner(
    afeCommandRef,
    kwsCommandRef,
    { kwsEnabled, kwsPreloadOnStart },
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

  const runState: PipelineRunState = {
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

  return (
    <div className="space-y-6">
      {/* Compact page header: title + Recent (project switcher) + core info,
          left-aligned. */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border border-line bg-surface-2 px-4 py-3">
        <h2 className="text-base font-semibold text-ink-1">Workspace</h2>
        <div className="flex flex-wrap items-center gap-2">
          <RecentProjectsMenu />
          <ProjectBar />
        </div>
      </div>

      <WorkspaceInner
        key={`ws-${current?.id ?? 'none'}`}
        afeCommandRef={afeCommandRef}
        kwsCommandRef={kwsCommandRef}
        kwsEnabled={kwsEnabled}
        toggleKws={toggleKws}
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
    </div>
  )
}

function WorkspaceInner({
  afeCommandRef,
  kwsCommandRef,
  kwsEnabled,
  toggleKws,
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
  afeCommandRef: React.MutableRefObject<import('../workspace/usePipelineRunner').PanelCommands | null>
  kwsCommandRef: React.MutableRefObject<import('../workspace/usePipelineRunner').PanelCommands | null>
  kwsEnabled: boolean
  toggleKws: (v: boolean) => void
  kwsPreloadOnStart: boolean
  setKwsPreloadOnStart: (v: boolean) => void
  fallbackChannels: 1 | 2
  runState: PipelineRunState
  onStart: () => void
  onStop: () => void
  setStatus: (patch: Partial<import('../status').ConsoleStatus>) => void
  persistWs: (patch: Partial<import('../workspace/types').WorkspaceConfig>) => void
  persistAfe: (patch: Partial<import('../projects/types').ProjectConfigSnapshot['afe']>) => void
  afeCfg: { channels?: 1 | 2; topology?: 'single-worklet' | 'node-per-stage'; latencyBudgetMs?: number; vizFps?: number } | undefined
  wsCfg: import('../workspace/types').WorkspaceConfig | undefined
  current: { id: string; name: string } | null
}) {
  const { frameData, bypass, toggleBypass } = useLiveAfe()
  const { setKwsRunning } = useLiveKws()
  const [afePipeline, setAfePipeline] = React.useState<AFEPipeline | null>(null)

  // Persistence config — lifted here so the per-module toggles AND the run
  // dashboard's clips panel share one source of truth (persist no-ops
  // without an active project).
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

  // Step A source state (re-seeded per project via the keyed wrapper).
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
  React.useEffect(() => {
    afeCommandRef.current = commandRef.current
  }, [afeCommandRef, commandRef])

  // Keep the top-bar mini bar's KWS node in sync with detection state.
  React.useEffect(() => {
    setKwsRunning(runState.kwsRunning)
  }, [runState.kwsRunning, setKwsRunning])

  // Register the pipeline stop for the top-bar mini bar's Stop button.
  const { registerStop } = useLiveAfe()
  React.useEffect(() => registerStop(onStop), [onStop, registerStop])

  // Active config tab (Source by default; KWS only selectable when enabled).
  const [activeTab, setActiveTab] = React.useState<PipelineTabId>('source')

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
  const afeInfo = `AFE · ${afeCfg?.topology ?? 'single-worklet'} · ${afeCfg?.latencyBudgetMs ?? 150} ms`

  const stageCards = [
    {
      id: 'source' as const,
      label: 'Source & AFE',
      preview: (
        <>
          <div>{sourcePreview}</div>
          <div className="mt-0.5 text-ink-3/70">{afeInfo}</div>
        </>
      ),
      color: '#64748b',
      enabled: true,
    },
    {
      id: 'aec' as const,
      label: 'AEC',
      preview: bypass.aec ? 'Bypassed — passthrough' : 'Active',
      color: '#818cf8',
      enabled: !bypass.aec,
      onToggleEnabled: () => handleToggleBypass('aec'),
    },
    {
      id: 'bss' as const,
      label: 'BSS',
      preview: bypass.bss ? 'Bypassed — passthrough' : 'Active',
      color: '#a78bfa',
      enabled: !bypass.bss,
      onToggleEnabled: () => handleToggleBypass('bss'),
    },
    {
      id: 'ns' as const,
      label: 'NS',
      preview: bypass.ns ? 'Bypassed' : 'Active',
      color: '#38bdf8',
      enabled: !bypass.ns,
      onToggleEnabled: () => handleToggleBypass('ns'),
      badge: persistence.ns.enabled ? 'persist' : undefined,
    },
    {
      id: 'kws' as const,
      label: 'KWS',
      preview: kwsPreview,
      color: '#34d399',
      enabled: kwsEnabled,
      onToggleEnabled: () => toggleKws(!kwsEnabled),
      badge: persistence.kws.enabled ? 'persist' : undefined,
    },
  ]

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      )}

      {/* ============ SETUP (before Start) ============
          Kept mounted (hidden) while running so the KWS engine and per-stage
          form state survive the switch to Live — unmounting would dispose
          the engine mid load (epic #53 KWS fix). */}
      <div className={previewVisible ? 'hidden' : ''}>
        {/* No outer box: the workspace page is flat — the sticky header and
            inner cards carry their own surfaces. */}
        <div>
          {/* Sticky unit: section header + stage cards pin to the workspace top
              while the active module panel scrolls underneath (blurred). */}
          <div className="sticky top-3 z-20 rounded-xl bg-surface-1/90 px-2 pb-2 shadow-md shadow-black/5 backdrop-blur-md">
            <div className="mb-2 flex flex-wrap items-center gap-2 border-b border-line pb-2">
              <span className="rounded bg-brand-500/20 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-widest text-brand-300">
                Setup
              </span>
              <span className="text-xs text-ink-3">configure each module, then Start — Stop returns here</span>
              <div className="ml-auto">
                <RunControl runState={runState} onStart={onStart} onStop={onStop} />
              </div>
            </div>
            <PipelineTabs
              active={activeTab}
              onSelect={setActiveTab}
              cards={stageCards}
            />
          </div>
          <div className="mt-4">

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
              color="#818cf8"
              number="2"
              title="AEC · Acoustic echo cancellation"
              note="Passthrough for v1 (ADR-016); the real engine + persistence wiring lands with it."
              bypassed={bypass.aec}
              onToggleBypass={handleToggleBypass}
            />
          </div>
          <div className={activeTab === 'bss' ? '' : 'hidden'}>
            <StageModulePanel
              id="bss"
              color="#a78bfa"
              number="3"
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
          <div className={activeTab === 'kws' ? '' : 'hidden'}>
            <StageModuleShell
              color="#34d399"
              number="5"
              title="KWS detection"
              note="Pluggable KWS backend (ADR-020) running in a Web Worker (ADR-018)"
              enabled={kwsEnabled}
              onToggle={() => toggleKws(!kwsEnabled)}
            >
              <StageSection>
                <div className="space-y-3">
                  <label className="flex items-center gap-2 text-sm">
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
                  <PersistenceStageToggle
                    stageId="kws"
                    label="Persist KWS output (16 kHz stream)"
                    config={persistence}
                    onChange={setPersistence}
                  />
                </div>
              </StageSection>
              <StageSection>
                {kwsEnabled ? (
                  <KWSPanel
                    key={`kws-${current?.id ?? 'none'}`}
                    afePipeline={afePipeline}
                    afeRunning={runState.afeRunning}
                    afeRef={afeRef}
                    commandRef={kwsCommandRef}
                    onPreview={setKwsPreview}
                    embedded
                  />
                ) : (
                  <p className="text-xs text-ink-3">
                    KWS is off — toggle it on above to configure the backend,
                    models and enrollment.
                  </p>
                )}
              </StageSection>
            </StageModuleShell>
          </div>
          </div>
        </div>
      </div>

      {/* ============ LIVE dashboard (after Start) ============ */}
      {previewVisible && (
        <div>
          <div className="sticky top-3 z-20 rounded-xl bg-surface-1/90 px-2 pb-2 shadow-md shadow-black/5 backdrop-blur-md">
            <div className="mb-2 flex flex-wrap items-center gap-2 border-b border-line pb-2">
              <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-widest text-emerald-300">
                Live
              </span>
              <span className="text-xs text-ink-3">running effects — Stop to reconfigure</span>
              <div className="ml-auto">
                <RunControl runState={runState} onStart={onStart} onStop={onStop} />
              </div>
            </div>
            {/* Live stage cards — identical to the Setup cards: same count,
                same layout (gap-2), waveform/curve as the preview. */}
            <div className="flex flex-wrap gap-2">
              <StageCard
                id="source"
                label="Source & AFE"
                glyph="⌗"
                color="#64748b"
                enabled
                preview={<WaveformCanvas data={frameData['aec']?.waveform} />}
              />
              {(['aec', 'bss', 'ns'] as const).map((id) => (
                <StageCard
                  key={id}
                  id={id}
                  label={id.toUpperCase()}
                  glyph={GLYPHS_LIVE[id]}
                  color={STAGE_COLORS_LIVE[id]}
                  enabled={!bypass[id]}
                  onToggleEnabled={() => handleToggleBypass(id)}
                  preview={<WaveformCanvas data={frameData[id]?.waveform} />}
                />
              ))}
              <StageCard
                id="kws"
                label="KWS"
                glyph="♪"
                color="#34d399"
                enabled={kwsEnabled}
                onToggleEnabled={() => toggleKws(!kwsEnabled)}
                preview={<MiniScoreCurve />}
              />
            </div>
          </div>

          <div className="mt-4 space-y-4">
            <PipelineLevelCurve frameData={frameData} running={runState.afeRunning} />
            {/* Detailed per-stage cards (waveform + level + metric + spectrum).
                Full width, like the chart above — no centered max-w cap that
                would leave side gutters. */}
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
        </div>
      )}
    </div>
  )
}
