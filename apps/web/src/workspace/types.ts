/**
 * Workspace-level configuration (epic #53).
 *
 * Lives in the project config snapshot under the `workspace` key (optional,
 * so existing IndexedDB projects load unchanged — see projects/types.ts).
 * Owns the pieces that span the pipeline as a whole rather than one module:
 *   - which components run (AFE master + per-stage toggles + KWS master)
 *   - the input source (mic device + options, or a set of files with
 *     per-channel loop/offset)
 *   - KWS preload behavior on Start
 *   - per-stage audio persistence (v1 scope: raw / NS / KWS — confirmed
 *     2026-08-07; AEC/BSS wire up when real engines land)
 *
 * App-level defaults for driver values / model sources live in the Settings
 * layer (localStorage, #52); this project snapshot overrides them per
 * project (layered persistence, #52/#53).
 */

/** A single file in the file source. */
export interface FileSourceItem {
  /** Local object URL (created at decode time, revoked on removal/stop). */
  url: string
  /** Original file name. */
  name: string
  /** Decoded sample rate (e.g. 44100 / 48000). */
  sampleRate: number
  /** Total duration in ms. */
  durationMs: number
  /** Channels discovered by decodeAudioData. */
  channels: FileChannelConfig[]
}

/** Per-channel loop/offset config (confirmed: concurrent mixing, each
 *  channel has its own loop + offset). */
export interface FileChannelConfig {
  index: number
  loop: boolean
  /** Start offset in ms (0..duration). */
  offsetMs: number
}

/** Microphone source options (device + browser DSP toggles). */
export interface MicSourceConfig {
  deviceId?: string
  echoCancellation: boolean
  noiseSuppression: boolean
  autoGainControl: boolean
  channelCount: 1 | 2
}

/** The input source selector state. */
export type InputSourceConfig =
  | { kind: 'mic'; mic: MicSourceConfig }
  | { kind: 'file'; files: FileSourceItem[] }

/** Persistence stage ids (v1 scope, confirmed 2026-08-07). */
export type PersistStageId = 'raw' | 'ns' | 'kws'

/** Per-stage persistence options. */
export interface PersistStageConfig {
  enabled: boolean
  /** Max capture seconds; undefined = until-stop ring with a cap. */
  maxSeconds?: number
}

/** Whole-workspace configuration persisted per project. */
export interface WorkspaceConfig {
  enabled: {
    afe: boolean
    /** AFE stage toggles (maps to the AFE bypass.* config). */
    afeStages: { aec: boolean; bss: boolean; ns: boolean }
    kws: boolean
  }
  /** Input source (default: default mic, browser DSP off). */
  source: InputSourceConfig
  /**
   * KWS preload-on-start behavior (confirmed 2026-08-07: auto-load gated by
   * a toggle, default ON).
   */
  kwsPreloadOnStart: boolean
  /** Per-stage persistence toggles (all off by default). */
  persistence: Record<PersistStageId, PersistStageConfig>
}

/** Default workspace configuration (new projects). */
export const DEFAULT_WORKSPACE_CONFIG: WorkspaceConfig = {
  enabled: {
    afe: true,
    afeStages: { aec: true, bss: true, ns: false },
    kws: false,
  },
  source: {
    kind: 'mic',
    mic: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1,
    },
  },
  kwsPreloadOnStart: true,
  persistence: {
    raw: { enabled: false },
    ns: { enabled: false },
    kws: { enabled: false },
  },
}
