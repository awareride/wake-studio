/**
 * Workspace orchestration (epic #53) - public exports.
 *
 * P1 scope: the WorkspaceConfig project-snapshot model (+ defaults) and the
 * shared viz components. Later P-steps add the source scheduler, the unified
 * pipeline runner, per-stage persistence and the config/preview layout.
 */

export {
  DEFAULT_WORKSPACE_CONFIG,
  type FileSourceItem,
  type FileChannelConfig,
  type MicSourceConfig,
  type InputSourceConfig,
  type PersistStageId,
  type PersistStageConfig,
  type WorkspaceConfig,
} from './types'
export {
  enumerateMicDevices,
  hasDeviceLabels,
  onDeviceChange,
  requestMicPermission,
  type MicDevice,
} from './sources/deviceList'
export {
  decodeAudioFile,
  FileScheduler,
  type DecodedFile,
} from './sources/fileSource'
