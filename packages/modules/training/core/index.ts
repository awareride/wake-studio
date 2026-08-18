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
  importResultBundle,
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
  trainPanelSpec,
  type TrainPanelSpec,
  type TrainableModuleLike,
} from './train-spec'
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
  retriedJob,
  importedJob,
  backendToMethod,
  sortJobsNewestFirst,
  upsertJob,
  deriveMessages,
  latestMessage,
  type HistoryJob,
  type StartedJobInput,
  type ImportedJobInput,
  type TrainMessage,
} from './history'
export {
  listJobs,
  getJob,
  saveJob,
  updateJobStatus,
  clearJobs,
  deleteJob,
} from './history-store'
export {
  personalizeNotebook,
  personalizedParamIds,
  type EnvParam,
} from './notebook'
