/**
 * Few-Shot module - public exports.
 *
 * @see docs/modules/few-shot.md for the full contract (Phase 3).
 */

export { FewShotEngine } from './FewShotEngine'
export { DEFAULT_CONFIG, describeParameters } from './defaults'
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
} from './dsp'
export type {
  EnrolledSample,
  FewShotConfig,
  ParameterDescriptor,
  SampleQuality,
  SerializedPrototype,
  WakeWordPrototype,
} from './types'
