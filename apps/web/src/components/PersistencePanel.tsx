/**
 * Per-stage persistence panel (epic #53 P5).
 *
 * Replaces the old 10 s RecordReplay card:
 *  - Config (Step D): per-stage enable toggles (raw / NS / KWS, v1 scope) +
 *    max seconds (ring cap), persisted in the workspace snapshot.
 *  - During run: a "Capture" button starts/stops the StageCapture stream;
 *    captured clips are saved to IndexedDB + exported as WAV files.
 *  - Replay: saved clips list per stage with Play (audio + waveform via the
 *    shared viz), Export WAV, Delete.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { AFEPipeline } from '@wake-studio/module-afe-graph'
import { useProjects } from '../projects'
import type { PersistStageId, WorkspaceConfig } from '../workspace/types'
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

const STAGE_LABELS: Record<PersistStageId, string> = {
  raw: 'Raw input',
  ns: 'NS output',
  kws: 'KWS output (16 kHz)',
}

interface Props {
  pipeline: AFEPipeline | null
  running: boolean
  /** Per-stage persistence config (from the workspace snapshot). */
  config?: WorkspaceConfig['persistence']
  onChange: (next: WorkspaceConfig['persistence']) => void
}

/** All-off default (v1: raw/NS/KWS; AEC/BSS wire up with real engines). */
function defaultConfig(): WorkspaceConfig['persistence'] {
  return {
    raw: { enabled: false },
    ns: { enabled: false },
    kws: { enabled: false },
  }
}

export function PersistencePanel({ pipeline, running, config, onChange }: Props) {
  const [capturing, setCapturing] = useState(false)
  const [clips, setClips] = useState<SavedClip[]>([])
  const captureRef = useRef<StageCapture | null>(null)
  const runningRef = useRef(running)
  const [waveSamples, setWaveSamples] = useState<Float32Array | null>(null)
  const { playingId, play, stop, attach } = useWavPlayback()
  const { current } = useProjects()

  // Local mirror of the persistence config so toggles work even without an
  // active project (persist no-ops then). Synced when the project snapshot
  // (re)loads / changes.
  const [localCfg, setLocalCfg] = useState<WorkspaceConfig['persistence']>(
    () => config ?? defaultConfig(),
  )
  useEffect(() => {
    setLocalCfg(config ?? defaultConfig())
  }, [config])

  const cfg = localCfg

  const refreshClips = useCallback(async () => {
    setClips(await listClips())
  }, [])

  const finalizeCapture = useCallback(async () => {
    const capture = captureRef.current
    captureRef.current = null
    if (!capture) return
    const buffers = capture.stop()
    if (buffers.length === 0) return
    // Save each non-empty buffer as a clip (IndexedDB) + export the WAV.
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
      const capture = new StageCapture()
      captureRef.current = capture
      // Max-seconds ring caps per stage (Step D; blank/0 = until stop).
      const limits: CaptureLimits = {
        raw: cfg.raw?.maxSeconds,
        ns: cfg.ns?.maxSeconds,
        kws: cfg.kws?.maxSeconds,
      }
      capture.start(
        pipeline,
        {
          raw: cfg.raw?.enabled ?? false,
          ns: cfg.ns?.enabled ?? false,
          kws: cfg.kws?.enabled ?? false,
        },
        limits,
      )
      setCapturing(true)
    } else {
      setCapturing(false)
      await finalizeCapture()
    }
  }, [pipeline, capturing, cfg, finalizeCapture])

  useEffect(() => {
    void refreshClips()
  }, [refreshClips])

  // Auto-stop the capture when the pipeline stops mid-capture and save what
  // was captured (design §6.2: "when a capture window ends (or the user
  // stops)").
  useEffect(() => {
    runningRef.current = running
    if (!running && capturing) {
      void handleCapture()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running])

  const enabledStages = (['raw', 'ns', 'kws'] as const).filter(
    (s) => cfg[s]?.enabled,
  )

  const handleToggleStage = (stage: PersistStageId) => {
    const next = {
      ...cfg,
      [stage]: { enabled: !cfg[stage]?.enabled, maxSeconds: cfg[stage]?.maxSeconds },
    }
    setLocalCfg(next)
    onChange(next)
  }

  const handleMaxSeconds = (stage: PersistStageId, value: string) => {
    const n = Number(value)
    const maxSeconds = value === '' || !Number.isFinite(n) || n <= 0 ? undefined : n
    const next = {
      ...cfg,
      [stage]: { enabled: cfg[stage]?.enabled ?? false, maxSeconds },
    }
    setLocalCfg(next)
    onChange(next)
  }

  const handlePlay = useCallback(
    async (clip: SavedClip) => {
      // Decode the WAV back to samples for the waveform view (shared viz).
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

  return (
    <div className="rounded-xl border border-line bg-surface-2 p-5">
      <h3 className="mb-1 text-sm font-semibold text-ink-1">
        Per-stage persistence{' '}
        <span className="text-xs font-normal text-ink-3">
          · raw / NS / KWS (v1)
        </span>
      </h3>
      <p className="mb-4 text-xs text-ink-3">
        Capture per-stage audio during a run and save it as WAV files; replay
        from the saved list with waveform.
      </p>

      {/* Step D config: per-stage enable + max seconds (ring cap). */}
      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2">
        {(['raw', 'ns', 'kws'] as const).map((stage) => (
          <div key={stage} className="flex items-center gap-2 text-sm">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={cfg[stage]?.enabled ?? false}
                onChange={() => handleToggleStage(stage)}
                className="h-3.5 w-3.5 rounded accent-brand-500"
              />
              <span className="text-ink-2">{STAGE_LABELS[stage]}</span>
            </label>
            {(cfg[stage]?.enabled ?? false) && (
              <label className="flex items-center gap-1 text-xs text-ink-3">
                max
                <input
                  type="number"
                  min={0}
                  placeholder="∞"
                  value={cfg[stage]?.maxSeconds ?? ''}
                  onChange={(e) => handleMaxSeconds(stage, e.target.value)}
                  className="h-6 w-14 rounded border border-line bg-surface-3 px-1.5 font-mono text-xs text-ink-1"
                />
                s
              </label>
            )}
          </div>
        ))}

        <button
          onClick={() => void handleCapture()}
          disabled={!running || enabledStages.length === 0}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 ${
            capturing
              ? 'bg-danger/90 text-ink-1 hover:bg-red-500'
              : 'bg-surface-3 text-ink-2 hover:bg-surface-4'
          }`}
        >
          {capturing ? 'Stop & save clips' : 'Capture'}
        </button>
        {!running && (
          <span className="text-xs text-ink-3">Start the pipeline to capture.</span>
        )}
        {running && enabledStages.length === 0 && (
          <span className="text-xs text-warning">Enable at least one stage.</span>
        )}
      </div>

      {/* Saved clips (replay list). */}
      {clips.length > 0 && (
        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-[11px] font-medium uppercase tracking-widest text-ink-3">
              Saved clips
            </div>
            <span className="text-[11px] text-ink-3">{clips.length} total</span>
          </div>
          {clips.map((clip) => (
            <div
              key={clip.id}
              className="rounded-lg border border-line bg-surface-2 p-2"
            >
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
