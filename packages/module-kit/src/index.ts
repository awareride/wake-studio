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

// Spec-driven device bundle generator (#189, ADR-047).
export {
  BundleGenerationError,
  generateDeviceBundle,
  type BundleFileMap,
  type BundleGenerationErrorCode,
  type BundleGeneratorInput,
  type GeneratedBundle,
  type GeneratedBundleModule,
} from './bundle-generator'

// Colab notebook seam (ADR-035): GitHub→Colab URL builder for module-owned
// notebooks (spec.train.notebookLocal).
export { buildColabUrl, SOURCE_REPO } from './panel-generator'

// i18n seam: the host registers its translator; generated panels translate
// their fixed copy through it (English identity when unregistered).
export { setUiTranslator, uiT, type UiTranslator } from './i18n'

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
