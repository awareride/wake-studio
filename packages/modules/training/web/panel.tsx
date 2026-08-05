/**
 * Training module - spec-driven panel (ADR-025 §3).
 *
 * Replaces the hand-written TrainingPanel stub with a generated panel from
 * the module spec. The panel is a pure function of the spec: params render via
 * module-kit's Ui* controls; backend wiring lands in goal.plan Phase 5. A
 * minimal controller holds local param state (no backend yet).
 */

import { useState, useCallback } from 'react'
import { renderPanel, type ModulePanelController } from '@wake-studio/module-kit'
import type { ModuleSpec } from '@wake-studio/contracts'
import trainingSpec from '../spec/module.spec.json'

const TRAINING_SPEC = trainingSpec as unknown as ModuleSpec

const GeneratedTrainingPanel = renderPanel(TRAINING_SPEC)

/** The training panel: rendered from the spec, not hand-written (ADR-025). */
export function TrainingModulePanel() {
  // Local controller state - no backend yet (Phase 5 wires runAction).
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [status, setStatus] = useState<Record<string, unknown>>({})

  const setValue = useCallback((id: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [id]: value }))
  }, [])

  const controller: ModulePanelController = {
    values,
    setValue,
    runAction: (actionId: string) => {
      // Phase 5: submit a TrainingJob to the selected backend. Today the
      // action is a no-op stub that reports the (not-yet-implemented) status.
      if (actionId === 'train') {
        setStatus((s) => ({ ...s, jobStatus: 'queued (backend lands in Phase 5)' }))
      }
    },
    status,
  }

  return <GeneratedTrainingPanel controller={controller} />
}

export default TrainingModulePanel
