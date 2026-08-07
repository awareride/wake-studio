/**
 * Per-module config panels (epic #53 UX overhaul).
 *
 * The old monolithic AFE panel is split into one panel per pipeline module:
 * Source (input + raw persistence + pipeline-global params), AEC, BSS, NS
 * (bypass + persistence where applicable). Each panel is pure config — the
 * engine lifecycle lives in useAfePipeline, live state in the shared context.
 */

import * as React from 'react'
import type { MutableRefObject } from 'react'
import type { AFEPipeline } from '@wake-studio/module-afe-graph'
import { describeParameters } from '@wake-studio/module-afe-graph'
import { UnifiedConfigPanel } from './UnifiedConfigPanel'
import { SourceConfigSection } from './SourceConfigSection'
import { PersistenceStageToggle } from './PersistenceStageToggle'
import type { SourceState, SourceActions } from '../workspace/useSourceConfig'
import type { WorkspaceConfig } from '../workspace/types'
import type { PersistStageId } from '../workspace/types'
import { cn } from './cn'

// ---------------------------------------------------------------------------
// Source tab: input source + raw persistence + pipeline-global params
// ---------------------------------------------------------------------------

interface SourcePanelProps {
  source: SourceState
  actions: SourceActions
  afeRef: MutableRefObject<AFEPipeline | null>
  running: boolean
  /** afe snapshot (topology / latencyBudgetMs / vizFps seed + persist). */
  projCfg: { topology?: 'single-worklet' | 'node-per-stage'; latencyBudgetMs?: number; vizFps?: number } | undefined
  persistAfe: (patch: Record<string, unknown>) => void
  persistence: WorkspaceConfig['persistence'] | undefined
  setPersistence: (next: WorkspaceConfig['persistence']) => void
}

const GLOBAL_PARAM_IDS = ['topology', 'vizFps', 'latencyBudgetMs']

export function SourcePanel({
  source,
  actions,
  afeRef,
  running,
  projCfg,
  persistAfe,
  persistence,
  setPersistence,
}: SourcePanelProps) {
  const params = describeParameters().filter((p) => GLOBAL_PARAM_IDS.includes(p.id))
  const [vizFps, setVizFps] = React.useState(projCfg?.vizFps ?? 30)

  return (
    <div className="space-y-4">
      <SourceConfigSection source={source} actions={actions} disabled={running} />

      <div className="rounded-xl border border-line bg-surface-3 p-4">
        <PersistenceStageToggle
          stageId="raw"
          label="Persist raw input (captures the mic/file stream)"
          config={persistence}
          onChange={setPersistence}
        />
      </div>

      <div className="rounded-xl border border-line bg-surface-3 p-4">
        <h4 className="mb-3 text-xs font-semibold uppercase tracking-widest text-ink-3">
          Pipeline settings
        </h4>
        <UnifiedConfigPanel
          title="Global AFE parameters"
          subtitle="Topology, visualization and latency budget."
          params={params}
          values={{
            vizFps,
            topology: projCfg?.topology ?? 'single-worklet',
            latencyBudgetMs: projCfg?.latencyBudgetMs ?? 150,
          }}
          onParamChange={(id, v) => {
            if (id === 'vizFps') {
              const n = Number(v)
              setVizFps(n)
              afeRef.current?.setConfig({ vizFps: n })
              persistAfe({ vizFps: n })
            } else if (id === 'topology') {
              const t = v as 'single-worklet' | 'node-per-stage'
              afeRef.current?.setConfig({ topology: t })
              persistAfe({ topology: t })
            } else if (id === 'latencyBudgetMs') {
              const n = Number(v)
              afeRef.current?.setConfig({ latencyBudgetMs: n })
              persistAfe({ latencyBudgetMs: n })
            }
          }}
          advancedIds={[]}
          disabled={running}
        />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// AEC / BSS / NS tabs
// ---------------------------------------------------------------------------

export function StageModulePanel({
  id,
  title,
  note,
  bypassed,
  onToggleBypass,
  persistence,
}: {
  id: 'aec' | 'bss' | 'ns'
  title: string
  note: string
  bypassed: boolean
  onToggleBypass: (id: 'aec' | 'bss' | 'ns') => void
  persistence?: React.ReactNode
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface-3 p-4">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-ink-1">{title}</h4>
          <p className="mt-0.5 text-xs text-ink-3">{note}</p>
        </div>
        <button
          onClick={() => onToggleBypass(id)}
          className={cn(
            'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
            bypassed
              ? 'bg-surface-4 text-ink-2 hover:bg-surface-3'
              : 'bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30',
          )}
        >
          {bypassed ? 'Bypassed' : 'Active'}
        </button>
      </div>
      {persistence && (
        <div className="rounded-xl border border-line bg-surface-3 p-4">{persistence}</div>
      )}
    </div>
  )
}

export function NsPanel({
  bypassed,
  onToggleBypass,
  persistence,
  setPersistence,
}: {
  bypassed: boolean
  onToggleBypass: (id: 'aec' | 'bss' | 'ns') => void
  persistence: WorkspaceConfig['persistence'] | undefined
  setPersistence: (next: WorkspaceConfig['persistence']) => void
}) {
  return (
    <StageModulePanel
      id="ns"
      title="NS · RNNoise noise suppression"
      note="RNNoise WASM (ADR-016). The only real DSP core in v1 — AEC/BSS are passthrough until the real engines land."
      bypassed={bypassed}
      onToggleBypass={onToggleBypass}
      persistence={
        <PersistenceStageToggle
          stageId="ns"
          label="Persist NS output (denoised audio)"
          config={persistence}
          onChange={setPersistence}
        />
      }
    />
  )
}

export type { PersistStageId }
