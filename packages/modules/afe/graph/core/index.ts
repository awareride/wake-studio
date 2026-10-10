/**
 * AFE graph module - core exports.
 *
 * @see docs/modules/afe.md for the full contract (ADR-016/017).
 */

export { AFEPipeline } from './AFEPipeline'
export {
  AFEParamError,
  defaultStageParams,
  validateStageParams,
} from './validate-params'
export {
  ChannelProbe,
  DUPLICATE_CORRELATION,
  ENERGY_IMBALANCE_RATIO,
  MIN_OBSERVATION_FRAMES,
  evaluateQualification,
} from './qualify'
export type {
  CaptureReport,
  QualificationLevel,
  QualificationResult,
} from './qualify'
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
  AFEStageParams,
  AFETopology,
  FileSourceConfig,
  FrameConfig,
  MicSourceConfig,
  ParameterDescriptor,
  PipelineSource,
  RecordedClip,
  SpectrogramData,
  StageFrameData,
  StageParamsByKind,
  StageState,
  StageStatus,
} from './types'
export { MicPermissionError, UnsupportedBrowserError } from './types'
