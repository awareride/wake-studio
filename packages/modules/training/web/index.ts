/**
 * Training module - web target.
 *
 * Re-exports the core contract and the spec-driven panel (ADR-025).
 */

export { type TrainingJob, type ArtifactBundleRef } from '../core'
export { validateBundle, importColabBundle, BundleImportError } from '../core'
export { TrainingModulePanel, default } from './panel'
