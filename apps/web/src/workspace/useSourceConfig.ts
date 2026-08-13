/**
 * Input-source configuration state (epic #53 P7).
 *
 * Lifted out of the AFE panel so the Step A source editor renders in the
 * workspace's Phase 1 flow while the pipeline start (owned by the AFE panel)
 * reads the same source.
 *
 * Draft/apply model (UX #113): switching the source tab (mic/file) and editing
 * the mic/file configs only updates the in-memory WORKING draft - nothing is
 * persisted. The draft becomes the project's saved source only on `apply()`
 * (explicit Apply button, or automatically when the pipeline starts, so what
 * you see is what runs). `dirty` reports whether the working draft differs
 * from the last persisted source.
 */

import * as React from 'react'
import type { MicSourceConfig } from '@wake-studio/module-afe-graph'
import type { WorkspaceConfig } from '../workspace/types'
import type { FileSourceItem } from '../workspace/types'

export interface SourceState {
  kind: 'mic' | 'file'
  mic: MicSourceConfig
  files: FileSourceItem[]
}

export interface SourceActions {
  /** Update the working mic config (draft only - not persisted). */
  updateMic: (next: MicSourceConfig) => void
  /** Switch the working source kind (draft only - not persisted). */
  updateKind: (kind: 'mic' | 'file') => void
  /** Update the working file list (draft only - not persisted). */
  updateFiles: (next: FileSourceItem[]) => void
  /** Persist the working draft as the project's source. */
  apply: () => void
}

/** Stable serialization (key-order insensitive) for draft-change detection. */
function stableKey(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(stableKey).join(',') + ']'
  if (v && typeof v === 'object') {
    return (
      '{' +
      Object.keys(v)
        .sort()
        .map((k) => `${k}:${stableKey((v as Record<string, unknown>)[k])}`)
        .join(',') +
      '}'
    )
  }
  return JSON.stringify(v)
}

export function useSourceConfig(
  wsCfg: WorkspaceConfig | undefined,
  persistWs: (patch: Partial<WorkspaceConfig>) => void,
  fallbackChannelCount: 1 | 2,
): SourceState &
  SourceActions & { kindChanged: boolean; dirty: boolean; appliedSource: SourceState } {
  const [mic, setMic] = React.useState<MicSourceConfig>(() => {
    const s = wsCfg?.source
    if (s?.kind === 'mic') {
      return {
        deviceId: s.mic.deviceId,
        echoCancellation: s.mic.echoCancellation ?? false,
        noiseSuppression: s.mic.noiseSuppression ?? false,
        autoGainControl: s.mic.autoGainControl ?? false,
        channelCount: s.mic.channelCount ?? fallbackChannelCount,
      }
    }
    return {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: fallbackChannelCount,
    }
  })

  const [kind, setKind] = React.useState<'mic' | 'file'>(
    wsCfg?.source?.kind === 'file' ? 'file' : 'mic',
  )
  const [files, setFiles] = React.useState<FileSourceItem[]>(() =>
    wsCfg?.source?.kind === 'file'
      ? (wsCfg.source.files ?? []).map((f) => ({ ...f, buffer: undefined }))
      : [],
  )

  // The last APPLIED source: what the project snapshot holds and what the

  // pipeline uses on Start (seeded from the snapshot; updated on apply). The
  // working `kind`/`mic`/`files` draft never affects Start - only Apply does.
  // `dirty` tracks the source KIND switch and the FILE LIST; mic config knobs
  // (device auto-pick, browser DSP toggles) are ephemeral and don't flag it.
  const [appliedSource, setAppliedSource] = React.useState<SourceState>(() => ({
    kind,
    mic,
    files,
  }))

  const updateMic = React.useCallback((next: MicSourceConfig) => {
    setMic(next)
  }, [])

  const updateKind = React.useCallback((next: 'mic' | 'file') => {
    setKind(next)
  }, [])

  const updateFiles = React.useCallback((next: FileSourceItem[]) => {
    setFiles(next)
  }, [])

  const apply = React.useCallback(() => {
    const next: SourceState = { kind, mic, files }
    persistWs({ source: next })
    setAppliedSource(next)
  }, [persistWs, kind, mic, files])

  const kindChanged = kind !== appliedSource.kind
  const dirty = kindChanged || stableKey(files) !== stableKey(appliedSource.files)

  return {
    kind,
    mic,
    files,
    updateMic,
    updateKind,
    updateFiles,
    apply,
    kindChanged,
    dirty,
    /** The committed source - what the pipeline actually uses on Start. */
    appliedSource,
  }
}
