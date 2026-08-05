/**
 * contracts package - shared WakeStudio contracts.
 *
 * Pure types + schemas only. No runtime logic, no framework deps - so any
 * world (web, local-service, device tooling) can import it.
 */
export type {
  ActionKind,
  ModuleAction,
  ModuleBuild,
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
  ParamType,
  ParamValidation,
  StatusRenderer,
} from './module-spec'
