/**
 * AFE graph module - core exports.
 *
 * @see docs/modules/afe.md for the full contract (ADR-016/017).
 */

export { AFEPipeline } from './AFEPipeline'
export { DEFAULT_CONFIG, describeParameters } from './defaults'
export {
  INTERNAL_SAMPLE_RATE,
  OUTPUT_SAMPLE_RATE,
  RNNOISE_FRAME_SIZE,
} from './defaults'

export type {
  AFEConfig,
  AFEOutputFrame,
  AFEStageKind,
  AFETopology,
  FrameConfig,
  ParameterDescriptor,
  RecordedClip,
  StageFrameData,
  StageState,
  StageStatus,
} from './types'
export { MicPermissionError, UnsupportedBrowserError } from './types'
