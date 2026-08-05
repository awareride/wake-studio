/**
 * Training module - core exports.
 *
 * The common training-job interface + the artifact bundle manifest (the
 * single retrieval contract for all backends). Backend adapters land in
 * goal.plan Phase 5; this module is the contract + the spec-driven panel.
 */

export type { TrainingJob, ArtifactBundleRef, TrainingBackendDescriptor, BackendCapability } from './job'
export {
  type ArtifactBundle,
  type ArtifactBundleMetadata,
  type ArtifactProvenance,
  validateBundle,
} from './manifest'
