/**
 * Training module - web target.
 *
 * Re-exports the core contract and the spec-driven train params panel
 * (ADR-025, issue #105): TrainParamsPanel renders a module's OWN
 * spec.train.params through the generated panel.
 */

export { type TrainingJob, type ArtifactBundleRef } from '../core'
export { validateBundle, importColabBundle, BundleImportError } from '../core'
export { TrainParamsPanel, default } from './panel'
export { trainPanelSpec, type TrainableModuleLike } from '../core'