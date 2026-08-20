/**
 * contracts package - shared WakeStudio contracts.
 *
 * Pure types + schemas only. No runtime logic, no framework deps - so any
 * world (web, studio-backend, device tooling) can import it.
 */
export type {
  ActionKind,
  ModuleAction,
  ModuleBuild,
  ModuleBuildInput,
  ModuleBuildToolchains,
  ModuleCategory,
  ModuleInterfaces,
  ModuleMeta,
  ModuleMaturity,
  ModuleParam,
  ModulePlayground,
  ModuleRuntime,
  ModuleScorecard,
  ModuleSpec,
  ModuleStatus,
  ModuleStatusFlag,
  ModuleTests,
  ModuleTrain,
  ModuleTTSEngine,
  ParamType,
  ParamValidation,
  StatusRenderer,
  AFEStage,
  AFEStageResult,
  AFEStageKind,
} from './module-spec'
export type {
  ProvisionArtifact,
  ProvisionKind,
  ProvisionListPayload,
  ProvisionPrototypePayload,
  ProvisionTrainPayload,
} from './provision'
export { isProvisionArtifactKind } from './provision'
