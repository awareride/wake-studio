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
  type ResultsAdapter,
  validateBundle,
  hasBundleModel,
  importColabBundle,
  BundleImportError,
  type BundleImportErrorCode,
  BUNDLE_IMPORT_ERROR_MESSAGES,
} from './manifest'
// Training console stepper + history rail (issue #105).
export {
  STEP_ORDER,
  STEP_DEFS,
  jobPhase,
  canAdvance,
  canGoBack,
  nextStepId,
  advanceStep,
  type TrainingStepId,
  type TrainingStepDef,
  type JobPhase,
} from './steps'
export {
  TRAIN_METHODS,
  TRAIN_METHOD_ORDER,
  methodsFor,
  supportsMethod,
  backendForMethod,
  type TrainMethod,
  type TrainMethodId,
} from './methods'
export {
  startedJob,
  importedJob,
  backendToMethod,
  sortJobsNewestFirst,
  upsertJob,
  deriveNews,
  type HistoryJob,
  type StartedJobInput,
  type ImportedJobInput,
  type TrainNewsItem,
} from './history'
export {
  listJobs,
  getJob,
  saveJob,
  updateJobStatus,
  clearJobs,
} from './history-store'
