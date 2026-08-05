/**
 * Few-Shot module - apps/web facade.
 *
 * The implementation moved to @wake-studio/module-few-shot (module-migration
 * §6.4). This file re-exports the module's public API for migration
 * compatibility. New imports should come from the module package directly.
 */

export { FewShotEngine } from '@wake-studio/module-few-shot'
export { DEFAULT_CONFIG, describeParameters } from '@wake-studio/module-few-shot'
export {
  cosineSimilarity,
  squaredEuclidean,
  plixScore,
  meanPool,
  peakDbfs,
  rmsDbfs,
  isClipped,
  estimateSnrDb,
  checkSampleQuality,
} from '@wake-studio/module-few-shot'
export type {
  EnrolledSample,
  FewShotConfig,
  ParameterDescriptor,
  SampleQuality,
  SerializedPrototype,
} from '@wake-studio/module-few-shot'
export type { WakeWordPrototype } from '@wake-studio/module-few-shot'
