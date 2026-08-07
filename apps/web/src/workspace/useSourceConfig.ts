/**
 * Input-source configuration state (epic #53 P7).
 *
 * Lifted out of the AFE panel so the Step A source editor renders in the
 * workspace's Phase 1 flow while the pipeline start (owned by the AFE panel)
 * reads the same source. Persisted to the workspace snapshot (`source` key).
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
  updateMic: (next: MicSourceConfig) => void
  updateKind: (kind: 'mic' | 'file') => void
  updateFiles: (next: FileSourceItem[]) => void
}

export function useSourceConfig(
  wsCfg: WorkspaceConfig | undefined,
  persistWs: (patch: Partial<WorkspaceConfig>) => void,
  fallbackChannelCount: 1 | 2,
): SourceState & SourceActions {
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

  const updateMic = React.useCallback(
    (next: MicSourceConfig) => {
      setMic(next)
      persistWs({ source: { kind: 'mic', mic: next } })
    },
    [persistWs],
  )

  const updateKind = React.useCallback(
    (next: 'mic' | 'file') => {
      setKind(next)
      if (next === 'mic') {
        persistWs({ source: { kind: 'mic', mic } })
      } else {
        persistWs({ source: { kind: 'file', files } })
      }
    },
    [persistWs, mic, files],
  )

  const updateFiles = React.useCallback(
    (next: FileSourceItem[]) => {
      setFiles(next)
      persistWs({ source: { kind: 'file', files: next } })
    },
    [persistWs],
  )

  return { kind, mic, files, updateMic, updateKind, updateFiles }
}
