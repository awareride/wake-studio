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
// Colab notebook seam (ADR-035)
// ---------------------------------------------------------------------------

/**
 * The source repo where module-owned Colab notebooks live. The generated
 * panel opens a notebook via the GitHub→Colab URL builder below; no server
 * and no credentials are involved (the user runs it in their own Colab
 * session, ADR-023).
 */
export const SOURCE_REPO = {
  org: 'awareride',
  repo: 'wake-studio',
  /** Notebooks are opened from the default branch; feature branches are out of scope. */
  ref: 'main',
} as const

/**
 * Build the GitHub→Colab URL for a module-owned notebook.
 *
 * `notebookLocal` is repo-relative (e.g.
 * "packages/modules/kws/openwakeword/train/colab/train.ipynb"), matching the
 * `playground.entry` / `tests.*` path convention, so no module-directory
 * derivation is needed.
 */
export function buildColabUrl(
  notebookLocal: string,
  source: typeof SOURCE_REPO = SOURCE_REPO,
): string {
  const path = notebookLocal.replace(/^\.?\//, '')
  return `https://colab.research.google.com/github/${source.org}/${source.repo}/blob/${source.ref}/${path}`
}

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
          <span className="text-sm text-ink-2">{statusDef.label}</span>
        </div>
      )
    case 'gauge':
      return <UiBar value={v} label={statusDef.label} height={10} threshold={0.8} />
    case 'text':
    default:
      return (
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-ink-2">{statusDef.label}</span>
          <span className="font-mono text-sm text-ink-1">{String(value ?? '—')}</span>
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
        <h2 className="text-lg font-semibold text-ink-1">
          {title ?? spec.meta.name}
        </h2>
        <p className="mt-1 text-sm text-ink-2">
          {spec.meta.category} module · v{spec.meta.version} ·{' '}
          <span className="text-ink-3">{spec.meta.license}</span>
        </p>
      </div>

      <div className="space-y-4 rounded-xl border border-line bg-surface-2 p-5">
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
            <div className="space-y-3 rounded-lg border border-line bg-surface-3 p-4">
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

        {/*
          Module-owned Colab notebook (ADR-035): when the module declares
          spec.train.notebookLocal, the generated panel renders an "Open in
          Colab" action. It is a plain external link — no server, no
          credentials; the user runs the notebook in their own Colab session.
        */}
        {spec.train?.notebookLocal && (
          <div className="flex flex-wrap gap-3 pt-2">
            <a
              href={buildColabUrl(spec.train.notebookLocal)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm font-medium text-ink-1 transition-colors hover:bg-surface-3"
            >
              <span aria-hidden>☁️</span>
              Open in Colab
            </a>
          </div>
        )}

        {/* Status (live values from controller.status). */}
        {spec.status.length > 0 && (
          <div className="grid gap-4 border-t border-line pt-4 sm:grid-cols-2">
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
