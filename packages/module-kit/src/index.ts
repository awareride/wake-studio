/**
 * module-kit package - shared WakeStudio module tooling (ADR-025).
 */
export {
  validateModuleSpec,
  scoreModule,
  type SpecValidationResult,
} from './validator'
export type { ModuleSpec } from '@wake-studio/contracts'
export type { ModuleScorecard } from '@wake-studio/contracts'

// Colab notebook seam (ADR-035): GitHub→Colab URL builder for module-owned
// notebooks (spec.train.notebookLocal).
export { buildColabUrl, SOURCE_REPO } from './panel-generator'

// Spec-driven UI kit (ADR-025 §3 panel generator).
export * from './ui'

// Panel generator: ModuleSpec -> React component (ADR-025 §3).
export {
  ModulePanel,
  renderPanel,
  defaultsFromSpec,
  type PanelSection,
  type ModulePanelController,
  type GeneratedPanelProps,
  type GeneratedModulePanelProps,
} from './panel-generator'
