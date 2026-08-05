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
