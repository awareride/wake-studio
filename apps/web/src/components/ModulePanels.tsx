/**
 * Per-module config panels (epic #53 UX).
 *
 * One unified, flat skeleton for every stage panel — the same order across
 * panels (plan: settings every stage shares sit at the top, never scattered):
 *
 *   1. Colored title row (big glyph + name, blended with the stage color)
 *      with the enable/disable pill on the right — same position everywhere
 *   2. Flat sections below, separated by dividers (no nested cards):
 *      persistence toggle first (where a stage has one), then the stage's
 *      own settings.
 *
 * The old Source panel's nested cards (source card / persist card / settings
 * card) are flattened into this shell.
 */

import * as React from 'react'
import type { MutableRefObject } from 'react'
import { Button } from '@radix-ui/themes'
import type { AFEPipeline } from '@wake-studio/module-afe-graph'
import { describeParameters } from '@wake-studio/module-afe-graph'
import { ParamRows } from './UnifiedConfigPanel'
import { SourceConfigSection } from './SourceConfigSection'
import { PersistenceStageToggle } from './PersistenceStageToggle'
import type { SourceState, SourceActions } from '../workspace/useSourceConfig'
import type { WorkspaceConfig } from '../workspace/types'
import type { ParamValue } from './UnifiedConfigPanel'

// ---------------------------------------------------------------------------
// Shared flat shell
// ---------------------------------------------------------------------------

export function StageModuleShell({
  color,
  number,
  title,
  note,
  enabled,
  onToggle,
  children,
}: {
  color: string
  number: string
  title: string
  note?: string
  enabled: boolean
  /** Enable/disable handler (undefined = no toggle, e.g. Source). */
  onToggle?: () => void
  /** Flat sections, each rendered as a divider-separated block. */
  children?: React.ReactNode
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface-2">
      <div
        className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
        style={{ background: `linear-gradient(90deg, ${color}1f, transparent 65%)` }}
      >
        <div className="flex min-w-0 items-center gap-3">
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-xl font-bold"
            style={{ background: `${color}26`, color }}
          >
            {number}
          </span>
          <div className="min-w-0">
            <h4 className="text-[15px] font-semibold text-ink-1">{title}</h4>
            {note && <p className="text-xs text-ink-3">{note}</p>}
          </div>
        </div>
        {onToggle && (
          <Button
            onClick={onToggle}
            aria-label={`${title} toggle`}
            aria-pressed={enabled}
            variant={enabled ? 'soft' : 'ghost'}
            color={enabled ? 'green' : 'gray'}
            size="1"
            radius="full"
            className="px-3 text-[10px] font-bold uppercase tracking-widest"
          >
            {enabled ? 'On' : 'Off'}
          </Button>
        )}
      </div>
      {children && (
        <div className="divide-y divide-line border-t border-line">{children}</div>
      )}
    </div>
  )
}

/** A flat section block inside a stage shell. */
export function StageSection({ children }: { children: React.ReactNode }) {
  return <div className="px-5 py-4">{children}</div>
}

/** Small uppercase label for a group inside a stage section. */
export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2.5 text-[13px] font-semibold uppercase tracking-widest text-ink-3">
      {children}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Source tab
// ---------------------------------------------------------------------------

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
}: {
  source: SourceState
  actions: SourceActions
  afeRef: MutableRefObject<AFEPipeline | null>
  running: boolean
  projCfg: { topology?: 'single-worklet' | 'node-per-stage'; latencyBudgetMs?: number; vizFps?: number } | undefined
  persistAfe: (patch: Record<string, unknown>) => void
  persistence: WorkspaceConfig['persistence']
  setPersistence: (next: WorkspaceConfig['persistence']) => void
}) {
  const params = describeParameters().filter((p) => GLOBAL_PARAM_IDS.includes(p.id))
  const [vizFps, setVizFps] = React.useState(projCfg?.vizFps ?? 30)
  const values: Record<string, ParamValue> = {
    vizFps,
    topology: projCfg?.topology ?? 'single-worklet',
    latencyBudgetMs: projCfg?.latencyBudgetMs ?? 150,
  }

  const onParamChange = (id: string, v: ParamValue) => {
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
  }

  return (
    <StageModuleShell
      color="#64748b"
      number="1"
      title="Source"
      note="input feed, raw persistence and AFE-wide settings"
      enabled
    >
      <StageSection>
        <SectionLabel>Persistence</SectionLabel>
        <PersistenceStageToggle
          stageId="raw"
          label="Persist raw input (captures the mic/file stream)"
          config={persistence}
          onChange={setPersistence}
        />
      </StageSection>
      <StageSection>
        <SectionLabel>Source</SectionLabel>
        <SourceConfigSection source={source} actions={actions} disabled={running} />
      </StageSection>
      <StageSection>
        <SectionLabel>AFE</SectionLabel>
        <p className="mb-2 text-xs text-ink-3">
          Pipeline-wide settings for the whole AEC → BSS → NS chain.
        </p>
        <div className="divide-y divide-line">
          {params.map((desc) => (
            <div key={desc.id} className="py-1">
              {ParamRows({
                ids: [desc.id],
                params,
                values,
                onParamChange,
                disabled: running,
              })}
            </div>
          ))}
        </div>
      </StageSection>
    </StageModuleShell>
  )
}

// ---------------------------------------------------------------------------
// AEC / BSS / NS tabs
// ---------------------------------------------------------------------------

export function StageModulePanel({
  id,
  color,
  number,
  title,
  note,
  bypassed,
  onToggleBypass,
  persistence,
}: {
  id: 'aec' | 'bss' | 'ns'
  color: string
  number: string
  title: string
  note: string
  bypassed: boolean
  onToggleBypass: (id: 'aec' | 'bss' | 'ns') => void
  /** Persistence toggle section (NS only in v1). */
  persistence?: React.ReactNode
}) {
  return (
    <StageModuleShell
      color={color}
      number={number}
      title={title}
      note={note}
      enabled={!bypassed}
      onToggle={() => onToggleBypass(id)}
    >
      {persistence && <StageSection>{persistence}</StageSection>}
    </StageModuleShell>
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
  persistence: WorkspaceConfig['persistence']
  setPersistence: (next: WorkspaceConfig['persistence']) => void
}) {
  return (
    <StageModulePanel
      id="ns"
      color="#38bdf8"
      number="4"
      title="NS · RNNoise noise suppression"
      note="The only real DSP core in v1 — AEC/BSS are passthrough until the real engines land (ADR-016)."
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
