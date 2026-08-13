/**
 * Training console — step → generated-panel section mapping (issue #105).
 *
 * The stepper is an app-layer container: it never renders controls itself,
 * it scopes the module's generated panel (ADR-025) per step. `configure`
 * shows the spec params; `run` shows the spec actions + live status; the
 * other steps are app-layer content (connect card / review card).
 */

import type { PanelSection } from '@wake-studio/module-kit'
import type { TrainingStepId } from '@wake-studio/module-training'

export function sectionsForStep(step: TrainingStepId): PanelSection[] {
  switch (step) {
    case 'configure':
      return ['params']
    case 'run':
      return ['actions', 'status']
    default:
      return []
  }
}