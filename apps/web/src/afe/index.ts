/**
 * AFE module - public exports.
 *
 * @see docs/modules/afe.md for the full contract (ADR-016/017).
 *
 * The implementation moved to @wake-studio/module-afe-graph (module-migration
 * §6.2); apps/web re-exports for compatibility during the migration. New
 * imports should come from the module package directly.
 */

export {
  AFEPipeline,
  DEFAULT_CONFIG,
  describeParameters,
  INTERNAL_SAMPLE_RATE,
  OUTPUT_SAMPLE_RATE,
  RNNOISE_FRAME_SIZE,
  MicPermissionError,
  UnsupportedBrowserError,
} from '@wake-studio/module-afe-graph'

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
} from '@wake-studio/module-afe-graph'
