/**
 * Training module - spec-driven panel (ADR-025 §3).
 *
 * Replaces the hand-written TrainingPanel stub with a generated panel from
 * the module spec. The panel is a pure function of the spec: params render via
 * module-kit's Ui* controls; backend wiring lands in goal.plan Phase 5. A
 * minimal controller holds local param state (no backend yet).
 *
 * Host props (training console, issue #105):
 * - `sections`: scope which generated sections render (e.g. params only on
 *   the "Configure" step, actions + status on "Run/monitor"). Undefined =
 *   everything, like today.
 * - `onAction`: notified when the user fires an action (train/export) with
 *   the current param values — lets the console record jobs in history.
 */

import { useEffect, useState, useCallback } from 'react'
import {
  defaultsFromSpec,
  renderPanel,
  type ModulePanelController,
  type PanelSection,
} from '@wake-studio/module-kit'
import type { ModuleSpec } from '@wake-studio/contracts'
import trainingSpec from '../spec/module.spec.json'

const TRAINING_SPEC = trainingSpec as unknown as ModuleSpec

const GeneratedTrainingPanel = renderPanel(TRAINING_SPEC)

export interface TrainingModulePanelProps {
  /** Scope which generated sections render (undefined = all). */
  sections?: PanelSection[]
  /**
   * Notified when an action fires, with a snapshot of the current param
   * values (stringified) — used by the training console to record history.
   */
  onAction?: (actionId: string, values: Record<string, string>) => void
  /**
   * Notified whenever the param values change (and once on mount) — the
   * wizard tracks the current params through this (issue #105).
   */
  onValuesChange?: (values: Record<string, string>) => void
}

function stringifyValues(values: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).map(([k, v]) => [k, String(v ?? '')]),
  )
}

/** The training panel: rendered from the spec, not hand-written (ADR-025). */
export function TrainingModulePanel({
  sections,
  onAction,
  onValuesChange,
}: TrainingModulePanelProps) {
  // Local controller state - no backend yet (Phase 5 wires runAction).
  // Initialize from the spec defaults so the console records real params in
  // history even when the user does not touch the form (issue #105).
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    defaultsFromSpec(TRAINING_SPEC),
  )
  const [status, setStatus] = useState<Record<string, unknown>>({})

  // Announce the initial (default) values once, on mount.
  useEffect(() => {
    onValuesChange?.(stringifyValues(values))
    // mount-only: the initial defaults are announced once; later changes
    // flow through setValue below.
  }, [])

  const setValue = useCallback(
    (id: string, value: unknown) => {
      setValues((prev) => {
        const next = { ...prev, [id]: value }
        onValuesChange?.(stringifyValues(next))
        return next
      })
    },
    [onValuesChange],
  )

  const controller: ModulePanelController = {
    values,
    setValue,
    runAction: (actionId: string) => {
      // Phase 5: submit a TrainingJob to the selected backend. Today the
      // action is a no-op stub that reports the (not-yet-implemented) status.
      onAction?.(actionId, stringifyValues(values))
      if (actionId === 'train') {
        setStatus((s) => ({ ...s, jobStatus: 'queued (backend lands in Phase 5)' }))
      }
    },
    status,
  }

  return <GeneratedTrainingPanel controller={controller} sections={sections} />
}

export default TrainingModulePanel