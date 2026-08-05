/**
 * Training module - web target.
 *
 * Re-exports the core contract and the spec-driven panel (ADR-025).
 */

export { type TrainingJob, type ArtifactBundleRef } from '../core'
export { validateBundle } from '../core'
export { TrainingModulePanel, default } from './panel'
