/**
 * Training module - spec-driven train params panel (ADR-025 §3, issue #105).
 *
 * Renders a module's OWN train params (built by `trainPanelSpec` from the
 * module's spec.train.params) through the generated panel - the wizard's
 * Configure step uses this, so each module provides its own train config and
 * nothing is hard-coded here. The panel stays controlled: the host tracks
 * the current values via `onValuesChange` (defaults announced on mount).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  defaultsFromSpec,
  renderPanel,
  type ModulePanelController,
} from '@wake-studio/module-kit'
import type { ModuleSpec } from '@wake-studio/contracts'
import type { TrainPanelSpec } from '../core/train-spec'

export interface TrainParamsPanelProps {
  /** Panel spec built from the module's spec.train.params (trainPanelSpec). */
  spec: TrainPanelSpec
  /** Notified on mount (defaults) and on every param change. */
  onValuesChange?: (values: Record<string, string>) => void
}

function stringifyValues(values: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).map(([k, v]) => [k, String(v ?? '')]),
  )
}

/** The training panel: rendered from the module spec, not hand-written. */
export function TrainParamsPanel({ spec, onValuesChange }: TrainParamsPanelProps) {
  const Panel = useMemo(
    () => renderPanel(spec as ModuleSpec),
    [spec],
  )

  const [values, setValues] = useState<Record<string, unknown>>(() =>
    defaultsFromSpec(spec as ModuleSpec),
  )

  // Re-initialize from defaults when the module (spec) changes — e.g. the
  // user goes back and picks a different model type — and announce the
  // defaults on mount / module change (issue #105).
  useEffect(() => {
    const defaults = defaultsFromSpec(spec as ModuleSpec)
    setValues(defaults)
    onValuesChange?.(stringifyValues(defaults))
  }, [spec, onValuesChange])

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
    runAction: () => {
      /* train params only - no actions in the wizard's Configure step */
    },
    status: {},
  }

  return <Panel controller={controller} sections={['params']} hideHeader compact />
}

export default TrainParamsPanel