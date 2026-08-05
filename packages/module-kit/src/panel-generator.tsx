/**
 * module-kit panel generator (ADR-025 §3).
 *
 * `renderPanel(spec)` is a PURE function: given a ModuleSpec it returns a
 * React component. No module ships a hand-written panel - the generator maps:
 *
 *   params  -> UiParamRow + spec control (mapper.tsx)
 *   actions -> UiButton (variant by action kind)
 *   status  -> Ui* canvas/bar by StatusRenderer
 *   group   -> primary | advanced (collapsible Advanced, ADR-024)
 *
 * The generated panel is CONTROLLED: it receives a ModulePanelController
 * (state + callbacks) from the host, so the module engine stays headless and
 * the panel is fully testable.
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import type {
  ModuleSpec,
  ModuleAction,
  ModuleStatus,
} from '@wake-studio/contracts'
import { UiButton, UiCollapsible, UiParamRow } from './ui/controls'
import { UiBar, UiWaveform, UiCurve } from './ui/canvas'
import { renderParamControl } from './ui/mapper'

// ---------------------------------------------------------------------------
// Panel controller contract (host-provided)
// ---------------------------------------------------------------------------

export interface ModulePanelController {
  /** Current param values (keyed by param.id). */
  values: Record<string, unknown>
  /** Apply a param change to the module engine. */
  setValue: (id: string, value: unknown) => void
  /** Invoke an action (load/start/train...). Return a promise if async. */
  runAction: (actionId: string) => void | Promise<void>
  /** Whether an action is currently busy (disables other controls). */
  actionBusy?: boolean
  /** Live status values (keyed by status.id). */
  status?: Record<string, unknown>
  /** Disable all controls (e.g. while loading). */
  disabled?: boolean
}

// ---------------------------------------------------------------------------
// Status renderer dispatch (ModuleStatus.renderer)
// ---------------------------------------------------------------------------

function renderStatus(
  statusDef: ModuleStatus,
  value: unknown,
): ReactNode {
  const v = typeof value === 'number' ? value : 0
  switch (statusDef.renderer) {
    case 'bar':
      return <UiBar value={v} label={statusDef.label} threshold={0.5} />
    case 'waveform': {
      const data = Array.isArray(value) ? value : (value as ArrayLike<number>) ? (value as ArrayLike<number>) : []
      return <UiWaveform data={data} />
    }
    case 'curve': {
      const data = Array.isArray(value) ? value : []
      return <UiCurve data={data} />
    }
    case 'badge':
      return (
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
          <span className="text-sm text-slate-300">{statusDef.label}</span>
        </div>
      )
    case 'gauge':
      return <UiBar value={v} label={statusDef.label} height={10} threshold={0.8} />
    case 'text':
    default:
      return (
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-slate-400">{statusDef.label}</span>
          <span className="font-mono text-sm text-slate-200">{String(value ?? '—')}</span>
        </div>
      )
  }
}

// ---------------------------------------------------------------------------
// Generated panel component
// ---------------------------------------------------------------------------

export interface GeneratedPanelProps {
  spec: ModuleSpec
  controller: ModulePanelController
  /** Override panel heading (defaults to spec.meta.name). */
  title?: string
}

/**
 * The panel generated from a ModuleSpec. Pure render: all state comes from
 * `controller`. Primary params render inline; `group: "advanced"` params
 * collapse under an "Advanced" section (ADR-024 dual layer).
 */
export function ModulePanel({ spec, controller, title }: GeneratedPanelProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false)

  const primary = spec.params.filter((p) => p.group === 'primary')
  const advanced = spec.params.filter((p) => p.group === 'advanced')
  const busy = controller.actionBusy ?? false
  const disabled = controller.disabled ?? busy

  return (
    <section className="mx-auto max-w-5xl px-6 py-12">
      {/* Panel header from spec.meta. */}
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-white">
          {title ?? spec.meta.name}
        </h2>
        <p className="mt-1 text-sm text-slate-400">
          {spec.meta.category} module · v{spec.meta.version} ·{' '}
          <span className="text-slate-500">{spec.meta.license}</span>
        </p>
      </div>

      <div className="space-y-4 rounded-xl border border-white/10 bg-white/[0.03] p-5">
        {/* Primary params. */}
        {primary.map((param) => (
          <UiParamRow
            key={param.id}
            label={param.label}
            description={param.description}
          >
            {renderParamControl({
              param,
              value: controller.values[param.id],
              onChange: (v) => controller.setValue(param.id, v),
              disabled,
            })}
          </UiParamRow>
        ))}

        {/* Advanced params (collapsible, ADR-024). */}
        {advanced.length > 0 && (
          <UiCollapsible
            label="Advanced"
            open={advancedOpen}
            onOpenChange={setAdvancedOpen}
          >
            <div className="space-y-3 rounded-lg border border-white/10 bg-slate-900/40 p-4">
              {advanced.map((param) => (
                <UiParamRow
                  key={param.id}
                  label={param.label}
                  description={param.description}
                >
                  {renderParamControl({
                    param,
                    value: controller.values[param.id],
                    onChange: (v) => controller.setValue(param.id, v),
                    disabled,
                  })}
                </UiParamRow>
              ))}
            </div>
          </UiCollapsible>
        )}

        {/* Actions. */}
        {spec.actions.length > 0 && (
          <div className="flex flex-wrap gap-3 pt-2">
            {spec.actions.map((action) => (
              <ActionButton
                key={action.id}
                action={action}
                disabled={disabled}
                onClick={() => controller.runAction(action.id)}
              />
            ))}
          </div>
        )}

        {/* Status (live values from controller.status). */}
        {spec.status.length > 0 && (
          <div className="grid gap-4 border-t border-white/5 pt-4 sm:grid-cols-2">
            {spec.status.map((statusDef) => (
              <div key={statusDef.id}>
                {renderStatus(statusDef, controller.status?.[statusDef.id])}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Action button (confirm support)
// ---------------------------------------------------------------------------

function ActionButton({
  action,
  disabled,
  onClick,
}: {
  action: ModuleAction
  disabled: boolean
  onClick: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const variant = action.kind === 'reset' || action.kind === 'stop' ? 'danger' : action.kind === 'train' || action.kind === 'export' || action.kind === 'start' ? 'primary' : 'secondary'

  const handleClick = () => {
    if (action.confirm && !confirming) {
      setConfirming(true)
      setTimeout(() => setConfirming(false), 2500)
      return
    }
    setConfirming(false)
    onClick()
  }

  return (
    <UiButton
      label={confirming ? 'Confirm?' : action.label}
      onClick={handleClick}
      variant={variant}
      disabled={disabled}
    />
  )
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * The component produced by `renderPanel`. Rendered by the host with a
 * controller; the spec is captured at creation time.
 */
export interface GeneratedModulePanelProps {
  controller: ModulePanelController
  /** Override panel heading. */
  title?: string
}

/**
 * Create a panel component from a spec.
 *
 * Pure: same spec in, same component out. The returned component takes a
 * `ModulePanelController` at render time, so the same generated panel can be
 * mounted against different module instances.
 */
export function renderPanel(spec: ModuleSpec) {
  const Panel = ({ controller, title }: GeneratedModulePanelProps) => (
    <ModulePanel spec={spec} controller={controller} title={title} />
  )
  Panel.displayName = `ModulePanel(${spec.meta.id})`
  return Panel
}

/** Convenience: map a param to its default. */
export function defaultsFromSpec(spec: ModuleSpec): Record<string, unknown> {
  return Object.fromEntries(spec.params.map((p) => [p.id, p.default]))
}
