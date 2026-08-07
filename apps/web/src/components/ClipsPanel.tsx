/**
 * Run-dashboard clips panel (epic #53 UX overhaul).
 *
 * The capture + replay half of the old PersistencePanel. Lives in the Phase 2
 * run dashboard: a Capture button streams the enabled stages (their toggles
 * now live in each module's config panel) and the saved-clips list replays
 * with waveform. Config (enable/max-seconds) moved to PersistenceStageToggle.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { AFEPipeline } from '@wake-studio/module-afe-graph'
import { useProjects } from '../projects'
import type { WorkspaceConfig } from '../workspace/types'
import {
  StageCapture,
  type CaptureLimits,
} from '../workspace/persistence/capture'
import {
  buildClip,
  saveClip,
  listClips,
  deleteClip,
  downloadWav,
  decodeWav,
  type SavedClip,
} from '../workspace/persistence'
import { WaveformCanvas, useWavPlayback } from './viz'

const STAGE_LABELS = {
  raw: 'Raw input',
  ns: 'NS output',
  kws: 'KWS output (16 kHz)',
} as const

interface Props {
  pipeline: AFEPipeline | null
  running: boolean
  /** Per-stage persistence config (from the workspace snapshot). */
  config?: WorkspaceConfig['persistence']
}

export function ClipsPanel({ pipeline, running, config }: Props) {
  const [capturing, setCapturing] = useState(false)
  const [clips, setClips] = useState<SavedClip[]>([])
  const captureRef = useRef<StageCapture | null>(null)
  const runningRef = useRef(running)
  const [waveSamples, setWaveSamples] = useState<Float32Array | null>(null)
  const { playingId, play, stop, attach } = useWavPlayback()
  const { current } = useProjects()

  const cfg: WorkspaceConfig['persistence'] = config ?? {
    raw: { enabled: false },
    ns: { enabled: false },
    kws: { enabled: false },
  }

  const refreshClips = useCallback(async () => {
    setClips(await listClips())
  }, [])

  useEffect(() => {
    void refreshClips()
  }, [refreshClips])

  // Auto-stop the capture when the pipeline stops mid-capture and save what
  // was captured.
  useEffect(() => {
    runningRef.current = running
    if (!running && capturing) {
      void handleCapture()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running])

  const finalizeCapture = useCallback(async () => {
    const capture = captureRef.current
    captureRef.current = null
    if (!capture) return
    const buffers = capture.stop()
    if (buffers.length === 0) return
    for (const buf of buffers) {
      const samples = buf.concat()
      const clip = buildClip(
        buf.stageId,
        samples,
        buf.sampleRate,
        current?.id,
        `${buf.stageId}-${new Date().toISOString().slice(11, 19)}`,
      )
      await saveClip(clip)
      downloadWav(new Uint8Array(await clip.blob.arrayBuffer()), `${clip.name}.wav`)
    }
    await refreshClips()
  }, [current?.id, refreshClips])

  const handleCapture = useCallback(async () => {
    if (!pipeline) return
    if (!capturing) {
      if (!runningRef.current) return
      const enabled = (['raw', 'ns', 'kws'] as const).filter((s) => cfg[s]?.enabled)
      if (enabled.length === 0) return
      const capture = new StageCapture()
      captureRef.current = capture
      const limits: CaptureLimits = {
        raw: cfg.raw?.maxSeconds,
        ns: cfg.ns?.maxSeconds,
        kws: cfg.kws?.maxSeconds,
      }
      capture.start(
        pipeline,
        { raw: cfg.raw?.enabled ?? false, ns: cfg.ns?.enabled ?? false, kws: cfg.kws?.enabled ?? false },
        limits,
      )
      setCapturing(true)
    } else {
      setCapturing(false)
      await finalizeCapture()
    }
  }, [pipeline, capturing, cfg, finalizeCapture])

  const handlePlay = useCallback(
    async (clip: SavedClip) => {
      const bytes = new Uint8Array(await clip.blob.arrayBuffer())
      try {
        setWaveSamples(decodeWav(bytes).samples)
      } catch {
        setWaveSamples(null)
      }
      play(clip.id, clip.blob)
    },
    [play],
  )

  const handleDelete = useCallback(
    (id: string) => {
      void deleteClip(id).then(refreshClips)
      if (playingId === id) stop()
    },
    [playingId, refreshClips, stop],
  )

  const enabledCount = (['raw', 'ns', 'kws'] as const).filter(
    (s) => cfg[s]?.enabled,
  ).length

  return (
    <div className="rounded-xl border border-line bg-surface-2 p-5">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-sm font-semibold text-ink-1">Per-stage clips</h3>
        <button
          onClick={() => void handleCapture()}
          disabled={!running || enabledCount === 0}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 ${
            capturing
              ? 'bg-danger/90 text-ink-1 hover:bg-red-500'
              : 'bg-surface-3 text-ink-2 hover:bg-surface-4'
          }`}
        >
          {capturing ? 'Stop & save clips' : 'Capture'}
        </button>
        {running && enabledCount === 0 && (
          <span className="text-xs text-warning">
            Enable persistence in a module config (Source/NS/KWS) first.
          </span>
        )}
      </div>

      {clips.length > 0 && (
        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-[11px] font-medium uppercase tracking-widest text-ink-3">
              Saved clips
            </div>
            <span className="text-[11px] text-ink-3">{clips.length} total</span>
          </div>
          {clips.map((clip) => (
            <div key={clip.id} className="rounded-lg border border-line bg-surface-2 p-2">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-xs font-medium text-ink-1">
                  {STAGE_LABELS[clip.stageId]}
                </span>
                <span className="text-[10px] text-ink-3">
                  {clip.name} · {(clip.durationMs / 1000).toFixed(1)}s ·{' '}
                  {clip.sampleRate / 1000} kHz
                </span>
                <div className="ml-auto flex items-center gap-2">
                  {playingId === clip.id ? (
                    <button
                      onClick={stop}
                      className="rounded bg-surface-3 px-2 py-0.5 text-xs text-ink-2 hover:bg-surface-4"
                    >
                      Stop
                    </button>
                  ) : (
                    <button
                      onClick={() => void handlePlay(clip)}
                      className="rounded bg-emerald-600/20 px-2 py-0.5 text-xs text-emerald-300 hover:bg-emerald-600/30"
                    >
                      Play
                    </button>
                  )}
                  <button
                    onClick={() => {
                      void clip.blob.arrayBuffer().then((buf) => {
                        downloadWav(new Uint8Array(buf), `${clip.name}.wav`)
                      })
                    }}
                    className="rounded bg-surface-3 px-2 py-0.5 text-xs text-ink-2 hover:bg-surface-4"
                  >
                    Export
                  </button>
                  <button
                    onClick={() => handleDelete(clip.id)}
                    className="rounded px-2 py-0.5 text-xs text-danger hover:bg-danger/10"
                  >
                    Delete
                  </button>
                </div>
              </div>
              {playingId === clip.id && (
                <div className="mt-2">
                  <WaveformCanvas data={waveSamples ?? undefined} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <audio ref={attach} className="hidden" />
    </div>
  )
}
