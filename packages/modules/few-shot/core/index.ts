/**
 * Few-Shot module - core exports.
 *
 * @see docs/modules/few-shot.md for the full contract (Phase 3).
 */

export { FewShotEngine } from './FewShotEngine'
export { DEFAULT_CONFIG, describeParameters } from './defaults'
export {
  cosineSimilarity,
  peakDbfs,
  rmsDbfs,
  isClipped,
  estimateSnrDb,
  checkSampleQuality,
} from './quality'
export { squaredEuclidean, plixScore, meanPool } from '@wake-studio/module-kws-plix'
export type {
  EnrolledSample,
  FewShotConfig,
  ParameterDescriptor,
  SampleQuality,
  SerializedPrototype,
} from './types'
export type { WakeWordPrototype } from '@wake-studio/module-kws-plix'
